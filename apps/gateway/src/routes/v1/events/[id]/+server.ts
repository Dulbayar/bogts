import { handle, json } from '$lib/server/api/errors';
import { authenticateProject } from '$lib/server/auth/api-key';
import { getEvent } from '$lib/server/events/feed';
import type { RequestHandler } from './$types';

/** `GET /v1/events/:id`: one of the caller's events (404 for anyone else's). */
export const GET: RequestHandler = handle(async ({ request, params, locals }) => {
	const project = await authenticateProject(request, locals.db);
	return json(await getEvent(locals.db, project.id, params.id));
});
