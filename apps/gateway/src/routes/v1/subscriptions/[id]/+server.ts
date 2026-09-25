import { handle, json } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { requireConfig } from '$lib/server/locals';
import { cancelSubscription, getSubscription } from '$lib/server/services/subscriptions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = handle(async ({ request, locals, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	return json(await getSubscription({ db: locals.db, config }, project.id, params.id));
});

/** `DELETE /v1/subscriptions/:id`: cancels the mandate at Bonum. No body; repeating it is harmless. */
export const DELETE: RequestHandler = handle(async ({ request, locals, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
	return json(await cancelSubscription(ctx, project.id, params.id));
});
