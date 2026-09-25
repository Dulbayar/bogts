import { error } from '@sveltejs/kit';
import { publicInvoice } from '$lib/server/public/invoice-view';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const invoice = await publicInvoice(locals.db, params.invoiceId);
	// The hosted QR page is for QPay invoices; Bonum invoices use Bonum's own checkout.
	if (!invoice || invoice.provider !== 'qpay') error(404, { message: 'Payment not found', code: 'not_found' });
	return { invoice, sandbox: locals.config?.qpay?.environment === 'test' };
};
