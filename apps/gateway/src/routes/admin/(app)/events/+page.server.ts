import { adminOnly } from '$lib/server/admin/actions';
import { cursorFrom, withScope } from '$lib/server/admin/common';
import { eventFilterFrom, eventsPage } from '$lib/server/admin/events';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	return withScope(locals, url, async (scope) => {
		const filter = eventFilterFrom(url, scope);
		return { ...(await eventsPage(locals.db, filter, cursorFrom(url))), filter };
	});
};
