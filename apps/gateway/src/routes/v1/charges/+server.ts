import { handle, json, parseJson, readBody } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import { ChargeListQuery, createCharge, CreateChargeInput, listCharges } from '$lib/server/services/charges';
import { queryOf } from '$lib/server/services/paging';
import type { RequestHandler } from './$types';

/**
 * `POST /v1/charges`: `{ subscriptionId, amount, reference }` → 201 Charge. The
 * status says how it went: `succeeded`, `failed` (with `failureCode`),
 * `queued` (a `charge.*` event follows) or `pending` (Bonum did not answer).
 */
export const POST: RequestHandler = handle(async ({ request, locals, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	return idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const input = parseJson(body, CreateChargeInput);
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		return json(await createCharge(ctx, project, input), 201);
	});
});

/** `GET /v1/charges?limit&cursor&subscriptionId&status` */
export const GET: RequestHandler = handle(async ({ request, locals, url }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const q = ChargeListQuery.parse(queryOf(url));
	return json(await listCharges({ db: locals.db, config }, project.id, q));
});
