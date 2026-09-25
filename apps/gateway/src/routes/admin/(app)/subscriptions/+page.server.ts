import { adminOnly } from '$lib/server/admin/actions';
import { cursorFrom } from '$lib/server/admin/common';
import { listSubscriptions, subscriptionCounts, subscriptionFilterFrom } from '$lib/server/admin/subscriptions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	adminOnly(locals);
	const { scope } = await parent();
	const filter = subscriptionFilterFrom(url, scope);
	const [page, counts] = await Promise.all([
		listSubscriptions(locals.db, filter, cursorFrom(url)),
		subscriptionCounts(locals.db, filter)
	]);
	return { page, counts, filter };
};
