import { handle, json } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { listEvents, parseFeedQuery } from '$lib/server/events/feed';
import type { RequestHandler } from './$types';

/**
 * `GET /v1/events`: the caller's events. Newest first with `?cursor=`, or
 * oldest first with `?after=<id>` (reconciliation); `?limit=1–100`,
 * `?type=invoice.paid,charge.failed`. Events younger than 5 s are held back
 * (see `events/feed.ts`).
 */
export const GET: RequestHandler = handle(async ({ request, url, locals }) => {
	const project = await authenticateProject(request, locals.db);
	return json(await listEvents(locals.db, project.id, parseFeedQuery(url.searchParams)));
});
