import { cursorFrom, withScope } from '$lib/server/admin/common';
import { invoiceFilterFrom, invoicesPage } from '$lib/server/admin/invoices';
import { adminOnly } from '$lib/server/admin/actions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	return withScope(locals, url, async (scope) => {
		const filter = invoiceFilterFrom(url, scope);
		return { ...(await invoicesPage(locals.db, filter, cursorFrom(url))), filter };
	});
};
