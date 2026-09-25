/**
 * Webhook signature check.
 *
 * Every webhook carries `Bogts-Signature: t=<unix seconds>,v1=<hex>`, where
 * `v1` is HMAC-SHA256 over `"<t>.<raw body>"` keyed with the project's
 * signing secret (`bgwh_…`). Verify the raw body exactly as received, before
 * parsing it.
 */
import { BogtsSignatureError } from './errors.js';
import type { BogtsEvent } from './types.js';

export const SIGNATURE_HEADER = 'Bogts-Signature';
export const EVENT_ID_HEADER = 'Bogts-Event-Id';
export const EVENT_TYPE_HEADER = 'Bogts-Event-Type';

/** The default tolerance between the signature's timestamp and now. */
export const DEFAULT_TOLERANCE_SEC = 300;

export interface VerifyOptions {
	/** Reject signatures older (or newer) than this many seconds. Default 300. */
	toleranceSec?: number;
	/** Current unix time in seconds; for tests. */
	now?: number;
}

const encoder = new TextEncoder();

/** Web Crypto: global in Workers, Deno, browsers and Node >= 19; `node:crypto` on Node 18. */
async function subtle(): Promise<SubtleCrypto> {
	const g = globalThis as { crypto?: Crypto };
	if (g.crypto?.subtle) return g.crypto.subtle;
	// A non-literal specifier, so bundlers for Workers and browsers leave it alone.
	const specifier = 'node:crypto';
	const mod = (await import(/* @vite-ignore */ specifier)) as { webcrypto: Crypto };
	return mod.webcrypto.subtle;
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const s = await subtle();
	const key = await s.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = new Uint8Array(await s.sign('HMAC', key, encoder.encode(message)));
	let hex = '';
	for (const b of mac) hex += b.toString(16).padStart(2, '0');
	return hex;
}

/** Compares two strings in time that depends only on their lengths. */
function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Parses `t=…,v1=…[,v1=…]`. Unknown schemes are ignored (forward compatible). */
export function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
	let timestamp: number | null = null;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const eq = part.indexOf('=');
		if (eq <= 0) continue;
		const key = part.slice(0, eq).trim();
		const value = part.slice(eq + 1).trim();
		if (key === 't') {
			if (!/^\d{1,12}$/.test(value) || timestamp !== null) {
				throw new BogtsSignatureError('malformed_header', 'Bogts-Signature has a bad timestamp');
			}
			timestamp = Number(value);
		} else if (key === 'v1') {
			signatures.push(value.toLowerCase());
		}
	}
	if (timestamp === null) throw new BogtsSignatureError('malformed_header', 'Bogts-Signature has no timestamp');
	if (signatures.length === 0) throw new BogtsSignatureError('no_signature', 'Bogts-Signature has no v1 signature');
	return { timestamp, signatures };
}

const bodyText = (raw: string | Uint8Array | ArrayBuffer): string =>
	typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

/**
 * Verifies a webhook and returns its event. Throws `BogtsSignatureError` when
 * the header is missing or malformed, no `v1` value matches, or the timestamp
 * is outside `toleranceSec` (default 300 s).
 *
 * `secret` may be a list during a secret rotation: any one matching is enough.
 */
export async function verifyWebhook(
	rawBody: string | Uint8Array | ArrayBuffer,
	signatureHeader: string | null | undefined,
	secret: string | string[],
	options: VerifyOptions = {}
): Promise<BogtsEvent> {
	if (!signatureHeader) throw new BogtsSignatureError('missing_header', 'Missing Bogts-Signature header');
	const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
	const body = bodyText(rawBody);
	const secrets = (Array.isArray(secret) ? secret : [secret]).filter(Boolean);
	if (secrets.length === 0) throw new TypeError('verifyWebhook: a signing secret is required');

	let matched = false;
	for (const s of secrets) {
		const expected = await hmacHex(s, `${timestamp}.${body}`);
		// Check every value (no early exit), so timing says nothing about which matched.
		for (const candidate of signatures) matched = constantTimeEqual(expected, candidate) || matched;
	}
	if (!matched) throw new BogtsSignatureError('mismatch', 'Bogts-Signature does not match the body');

	const tolerance = options.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
	const now = options.now ?? Math.floor(Date.now() / 1000);
	if (tolerance > 0 && Math.abs(now - timestamp) > tolerance) {
		throw new BogtsSignatureError('timestamp_out_of_tolerance', 'Bogts-Signature timestamp is too old or in the future');
	}

	try {
		return JSON.parse(body) as BogtsEvent;
	} catch {
		throw new BogtsSignatureError('invalid_payload', 'The webhook body is not valid JSON');
	}
}

/**
 * `verifyWebhook` for a Fetch API `Request` (SvelteKit, Hono's `c.req.raw`,
 * Workers, Deno, Bun): reads the raw body and the `Bogts-Signature` header.
 */
export async function constructEvent(
	request: Request,
	secret: string | string[],
	options: VerifyOptions = {}
): Promise<BogtsEvent> {
	const raw = await request.text();
	return verifyWebhook(raw, request.headers.get(SIGNATURE_HEADER), secret, options);
}
