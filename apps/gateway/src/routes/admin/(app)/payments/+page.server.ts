import { cursorFrom } from '$lib/server/admin/common';
import { invoiceCounts, invoiceFilterFrom, listInvoices } from '$lib/server/admin/invoices';
import { adminOnly } from '$lib/server/admin/actions';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	adminOnly(locals);
	const { scope } = await parent();
	const filter = invoiceFilterFrom(url, scope);
	const [page, counts] = await Promise.all([listInvoices(locals.db, filter, cursorFrom(url)), invoiceCounts(locals.db, filter)]);
	return { page, counts, filter };
};
