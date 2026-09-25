import { adminOnly } from '$lib/server/admin/actions';
import { cursorFrom } from '$lib/server/admin/common';
import { chargeCounts, chargeFilterFrom, listCharges } from '$lib/server/admin/charges';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	adminOnly(locals);
	const { scope } = await parent();
	const filter = chargeFilterFrom(url, scope);
	const [page, counts] = await Promise.all([listCharges(locals.db, filter, cursorFrom(url)), chargeCounts(locals.db, filter)]);
	return { page, counts, filter };
};
