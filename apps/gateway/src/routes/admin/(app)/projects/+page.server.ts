import { adminOnly } from '$lib/server/admin/actions';
import { listProjects } from '$lib/server/admin/projects';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminOnly(locals);
	return { list: await listProjects(locals.db) };
};
