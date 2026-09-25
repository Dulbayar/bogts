import { error } from '@sveltejs/kit';
import { publicInvoice } from '$lib/server/public/invoice-view';
import { payeeOf } from '$lib/server/public/payee';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, setHeaders, parent }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const invoice = await publicInvoice(locals.db, params.invoiceId);
	// The hosted QR page is for QPay invoices; Bonum invoices use Bonum's own checkout.
	if (!invoice || invoice.provider !== 'qpay') error(404, { message: 'Payment not found', code: 'not_found' });
	const { brand } = await parent();
	return { invoice, payee: payeeOf(invoice, brand), sandbox: locals.config?.qpay?.environment === 'test' };
};
