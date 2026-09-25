/** `POST /v1/invoices/:id/cancel` (no body). */
import { authenticateProject } from '$lib/server/auth/api-key';
import { handle, json, readBody } from '$lib/server/api/errors';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import { cancelInvoice, invoiceJson } from '$lib/server/services/invoices';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = handle(async ({ request, locals, params, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	return idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		const inv = await cancelInvoice(ctx, project.id, params.id);
		return json(invoiceJson(inv, config));
	});
});
