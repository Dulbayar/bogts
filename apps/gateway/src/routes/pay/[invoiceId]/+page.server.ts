import { error } from '@sveltejs/kit';
import { publicInvoice } from '$lib/server/public/invoice-view';
import { payeeOf } from '$lib/server/public/payee';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const invoice = await publicInvoice(locals.db, params.invoiceId);
	// The hosted QR page is for QPay invoices; Bonum invoices use Bonum's own checkout.
	if (!invoice || invoice.provider !== 'qpay') error(404, { message: 'Payment not found', code: 'not_found' });
	// The company branding came in the invoice query (no extra round trip).
	return { invoice, brand: invoice.brand, payee: payeeOf(invoice, invoice.brand), sandbox: locals.config?.qpay?.environment === 'test' };
};
