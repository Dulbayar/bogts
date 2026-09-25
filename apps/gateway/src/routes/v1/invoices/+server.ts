/** `POST /v1/invoices` (create, or reuse a pending one) and `GET /v1/invoices` (list). */
import { authenticateProject } from '$lib/server/auth/api-key';
import { ApiError, describeZodError, handle, json, parseJson, readBody } from '$lib/server/api/errors';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import {
	createInvoiceSchema,
	invoiceJson,
	listInvoices,
	listInvoicesSchema,
	openInvoice
} from '$lib/server/services/invoices';
import type { RequestHandler } from './$types';

/** `true` when POST /v1/invoices handed back a pending invoice for the same purchase, else `false`. */
const REUSED_HEADER = 'bogts-reused';

export const POST: RequestHandler = handle(async ({ request, locals, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	const res = await idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const input = parseJson(body, createInvoiceSchema);
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		// 201 for a new invoice; 200 when a pending one for the same purchase is handed back.
		const { invoice, reused } = await openInvoice(ctx, project, input);
		return json(invoiceJson(invoice, config), reused ? 200 : 201);
	});
	// `Bogts-Reused` says the same as the status; set here so an idempotent replay carries it too.
	if (res.status === 200 || res.status === 201) res.headers.set(REUSED_HEADER, String(res.status === 200));
	return res;
});

export const GET: RequestHandler = handle(async ({ request, locals, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const parsed = listInvoicesSchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) throw new ApiError(400, 'invalid_request', describeZodError(parsed.error));
	const page = await listInvoices({ db: locals.db, config }, project.id, parsed.data);
	return json({
		object: 'list',
		data: page.data.map((inv) => invoiceJson(inv, config)),
		hasMore: page.hasMore,
		nextCursor: page.nextCursor
	});
});
