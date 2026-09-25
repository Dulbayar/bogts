import { adminOnly } from '$lib/server/admin/actions';
import { cursorFrom, withScope } from '$lib/server/admin/common';
import { subscriptionFilterFrom, subscriptionsPage } from '$lib/server/admin/subscriptions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	return withScope(locals, url, async (scope) => {
		const filter = subscriptionFilterFrom(url, scope);
		return { ...(await subscriptionsPage(locals.db, filter, cursorFrom(url))), filter };
	});
};
