import { handle, json, readBody } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { idempotencyKey, idempotent } from '$lib/server/idempotency';
import { requireConfig } from '$lib/server/locals';
import { reverseCharge } from '$lib/server/services/charges';
import type { RequestHandler } from './$types';

/** `POST /v1/charges/:id/reverse`: reverses a succeeded charge at Bonum. No body. */
export const POST: RequestHandler = handle(async ({ request, locals, url, params }) => {
	const config = requireConfig(locals);
	const project = await authenticateProject(request, locals.db);
	const key = idempotencyKey(request);
	const body = await readBody(request);
	return idempotent(locals.db, { projectId: project.id, key, method: 'POST', path: url.pathname, body }, async () => {
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		return json(await reverseCharge(ctx, project.id, params.id));
	});
});
