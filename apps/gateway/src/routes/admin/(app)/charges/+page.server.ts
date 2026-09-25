import { adminOnly } from '$lib/server/admin/actions';
import { cursorFrom, withScope } from '$lib/server/admin/common';
import { chargeFilterFrom, chargesPage } from '$lib/server/admin/charges';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	return withScope(locals, url, async (scope) => {
		const filter = chargeFilterFrom(url, scope);
		return { ...(await chargesPage(locals.db, filter, cursorFrom(url))), filter };
	});
};
