import { error } from '@sveltejs/kit';
import { publicInvoice } from '$lib/server/public/invoice-view';
import { payeeOf } from '$lib/server/public/payee';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const invoice = await publicInvoice(locals.db, params.invoiceId);
	// The hosted page shows a QR (QPay, or Bonum's QR); a Bonum checkout is paid on Bonum's own page.
	if (!invoice || invoice.method !== 'qr') error(404, { message: 'Payment not found', code: 'not_found' });
	const environment = invoice.provider === 'qpay' ? locals.config?.qpay?.environment : locals.config?.bonum?.environment;
	// The company branding came in the invoice query (no extra round trip).
	return { invoice, brand: invoice.brand, payee: payeeOf(invoice, invoice.brand), sandbox: environment === 'test' };
};
