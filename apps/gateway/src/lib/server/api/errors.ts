/**
 * API errors and JSON responses for `/v1` (and `/hooks`, `/health`).
 *
 * The error shape is always `{ error: { code, message } }`. Messages are safe
 * to show: they never echo provider text, secrets or stack traces. Anything
 * that is not an `ApiError` (or a zod validation error) becomes a 500
 * `internal_error`, and only its name is logged.
 */
import { z } from 'zod';

export type ErrorCode =
	| 'unauthorized'
	| 'not_found'
	| 'invalid_json'
	| 'invalid_request'
	| 'payload_too_large'
	| 'conflict'
	| 'idempotency_key_reused'
	| 'idempotency_in_progress'
	| 'provider_disabled'
	| 'provider_error'
	| 'rate_limited'
	| 'not_configured'
	| 'internal_error'
	// Providers and services may add their own specific codes.
	| (string & {});

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: ErrorCode,
		message: string,
		readonly headers?: Record<string, string>
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export type ErrorBody = { error: { code: string; message: string } };

const NO_STORE = { 'cache-control': 'no-store' };

/** A JSON response. `Cache-Control: no-store`: API answers are never cacheable. */
export function json(data: unknown, init: number | ResponseInit = 200): Response {
	const base: ResponseInit = typeof init === 'number' ? { status: init } : init;
	const headers = new Headers(base.headers);
	headers.set('content-type', 'application/json; charset=utf-8');
	for (const [k, v] of Object.entries(NO_STORE)) if (!headers.has(k)) headers.set(k, v);
	return new Response(JSON.stringify(data), { ...base, headers });
}

export function errorJson(status: number, code: ErrorCode, message: string, headers?: Record<string, string>): Response {
	return json({ error: { code, message } } satisfies ErrorBody, { status, headers });
}

/** The first zod issue as `path: message`, e.g. `amount: Too small: expected number to be >0`. */
export function describeZodError(err: z.ZodError): string {
	const issue = err.issues[0];
	if (!issue) return 'Invalid request';
	const path = issue.path.map(String).join('.');
	return path ? `${path}: ${issue.message}` : issue.message;
}

/** Maps any thrown value to the error response. Unknown errors are logged by name only. */
export function errorResponse(err: unknown): Response {
	if (err instanceof ApiError) return errorJson(err.status, err.code, err.message, err.headers);
	if (err instanceof z.ZodError) return errorJson(400, 'invalid_request', describeZodError(err));
	const name = err instanceof Error ? err.name : typeof err;
	console.error('[api] unhandled error', name);
	return errorJson(500, 'internal_error', 'Something went wrong. Try again.');
}

/**
 * Wraps a `+server.ts` handler: whatever it throws becomes the JSON error shape.
 *
 * ```ts
 * export const POST = handle(async ({ request, locals }) => {
 *   const project = await authenticateProject(request, locals.db);
 *   const input = parseJson(await readBody(request), createInvoiceSchema);
 *   const { invoice, reused } = await openInvoice(ctx, project, input);
 *   return json(invoiceJson(invoice, config), reused ? 200 : 201);
 * });
 * ```
 */
export function handle<E>(fn: (event: E) => Response | Promise<Response>): (event: E) => Promise<Response> {
	return async (event) => {
		try {
			return await fn(event);
		} catch (err) {
			return errorResponse(err);
		}
	};
}

/** The request body cap for the project API and provider webhooks. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Reads the body as text, refusing more than `maxBytes` (413) without buffering
 * an unbounded stream. Use this for webhooks, which must be verified on the
 * exact bytes before parsing.
 */
export async function readBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<string> {
	const declared = Number(request.headers.get('content-length') ?? '');
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new ApiError(413, 'payload_too_large', `Body is larger than ${maxBytes} bytes`);
	}
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel().catch(() => {});
			throw new ApiError(413, 'payload_too_large', `Body is larger than ${maxBytes} bytes`);
		}
		chunks.push(value);
	}
	const all = new Uint8Array(size);
	let offset = 0;
	for (const c of chunks) {
		all.set(c, offset);
		offset += c.byteLength;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(all);
	} catch {
		throw new ApiError(400, 'invalid_request', 'Body is not valid UTF-8');
	}
}

/** Parses JSON text against a zod schema: 400 `invalid_json` or `invalid_request`. */
export function parseJson<S extends z.ZodType>(text: string, schema: S): z.output<S> {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new ApiError(400, 'invalid_json', 'Body is not valid JSON');
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw new ApiError(400, 'invalid_request', describeZodError(parsed.error));
	return parsed.data;
}

/** `readBody` + `parseJson`. */
export async function readJson<S extends z.ZodType>(
	request: Request,
	schema: S,
	maxBytes = MAX_BODY_BYTES
): Promise<z.output<S>> {
	return parseJson(await readBody(request, maxBytes), schema);
}

/** Common errors. */
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
