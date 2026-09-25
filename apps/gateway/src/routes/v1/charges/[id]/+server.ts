import { handle, json } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { requireConfig } from '$lib/server/locals';
import { getCharge } from '$lib/server/services/charges';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handle(async ({ request, locals, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	return json(await getCharge({ db: locals.db, config }, project.id, params.id));
});
