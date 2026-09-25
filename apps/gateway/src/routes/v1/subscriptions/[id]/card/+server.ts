import { handle, json, readBody } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import { replaceCard } from '$lib/server/services/subscriptions';
import type { RequestHandler } from './$types';

/** `POST /v1/subscriptions/:id/card`: starts a card change; the Subscription comes back with `redirectUrl`. */
export const POST: RequestHandler = handle(async ({ request, locals, url, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	return idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		return json(await replaceCard(ctx, project.id, params.id));
	});
});
