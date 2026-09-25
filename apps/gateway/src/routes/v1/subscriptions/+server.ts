import { handle, json, parseJson, readBody } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import { queryOf } from '$lib/server/services/paging';
import {
	createSubscription,
	CreateSubscriptionInput,
	listSubscriptions,
	SubscriptionListQuery
} from '$lib/server/services/subscriptions';
import type { RequestHandler } from './$types';

/** `POST /v1/subscriptions`: `{ plan, customerRef, email?, returnUrl }` → 201 Subscription (with `redirectUrl`). */
export const POST: RequestHandler = handle(async ({ request, locals, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	return idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const input = parseJson(body, CreateSubscriptionInput);
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		return json(await createSubscription(ctx, project, input), 201);
	});
});

/** `GET /v1/subscriptions?limit&cursor&customerRef&status` */
export const GET: RequestHandler = handle(async ({ request, locals, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const q = SubscriptionListQuery.parse(queryOf(url));
	return json(await listSubscriptions({ db: locals.db, config }, project.id, q));
});
