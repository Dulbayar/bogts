import { overview, periodFrom } from '$lib/server/admin/overview';
import { requireConfig } from '$lib/server/locals';
import { adminOnly } from '$lib/server/admin/actions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	adminOnly(locals);
	const { scope } = await parent();
	const period = periodFrom(url);
	return { period, ...(await overview(locals.db, requireConfig(locals), { projectId: scope, period })) };
};
