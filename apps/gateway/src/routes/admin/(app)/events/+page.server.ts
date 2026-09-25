import { adminOnly } from '$lib/server/admin/actions';
import { cursorFrom } from '$lib/server/admin/common';
import { eventCounts, eventFilterFrom, listEvents } from '$lib/server/admin/events';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	adminOnly(locals);
	const { scope } = await parent();
	const filter = eventFilterFrom(url, scope);
	const [page, counts] = await Promise.all([listEvents(locals.db, filter, cursorFrom(url)), eventCounts(locals.db, filter)]);
	return { page, counts, filter };
};
