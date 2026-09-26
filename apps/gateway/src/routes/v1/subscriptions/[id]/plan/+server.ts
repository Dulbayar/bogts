import { handle, json, parseJson, readBody } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import { ChangePlanInput, changePlan } from '$lib/server/services/plan-change';
import type { RequestHandler } from './$types';

/**
 * `POST /v1/subscriptions/:id/plan` `{ plan }`: moves the subscription to `plan`
 * when its paid period ends (`nextBillAt`), on the saved card. The current plan
 * undoes a scheduled change.
 */
export const POST: RequestHandler = handle(async ({ request, locals, url, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	return idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		return json(await changePlan(ctx, project.id, params.id, parseJson(body, ChangePlanInput)));
	});
});
