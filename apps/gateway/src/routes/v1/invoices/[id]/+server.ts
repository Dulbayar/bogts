/** `GET /v1/invoices/:id` */
import { authenticateProject } from '$lib/server/auth/api-key';
import { handle, json } from '$lib/server/api/errors';
import { requireConfig } from '$lib/server/locals';
import { getInvoice, invoiceJson } from '$lib/server/services/invoices';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handle(async ({ request, locals, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const inv = await getInvoice({ db: locals.db, config }, project.id, params.id);
	return json(invoiceJson(inv, config));
});
