import { adminOnly } from '$lib/server/admin/actions';
import { withScope } from '$lib/server/admin/common';
import { monthFrom, usageTable } from '$lib/server/admin/usage';
import { monthOf } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	const month = monthFrom(url);
	// The current month in Ulaanbaatar time, like the month bounds.
	const current = monthOf(Date.now());
	return { month, current, ...(await withScope(locals, url, (projectId) => usageTable(locals.db, { month, projectId }))) };
};
