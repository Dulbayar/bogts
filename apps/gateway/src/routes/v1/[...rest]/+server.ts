import { errorJson } from '$lib/server/api/errors';
import type { RequestHandler } from './$types';

/** Unknown `/v1` paths and methods answer in the API's JSON error shape, not an HTML page. */
export const fallback: RequestHandler = () => errorJson(404, 'not_found', 'No such API endpoint');
