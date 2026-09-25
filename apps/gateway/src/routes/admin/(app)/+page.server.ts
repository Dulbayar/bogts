import { overview, periodFrom } from '$lib/server/admin/overview';
import { withScope } from '$lib/server/admin/common';
import { requireConfig } from '$lib/server/locals';
import { adminOnly } from '$lib/server/admin/actions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	const config = requireConfig(locals);
	const period = periodFrom(url);
	// Not `await parent()`: the layout loads in parallel, and the scope check overlaps the reads.
	return { period, ...(await withScope(locals, url, (projectId) => overview(locals.db, config, { projectId, period }))) };
};
