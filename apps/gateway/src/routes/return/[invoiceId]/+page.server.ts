import { error } from '@sveltejs/kit';
import { publicInvoice } from '$lib/server/public/invoice-view';
import { payeeOf } from '$lib/server/public/payee';
import type { PageServerLoad } from './$types';

/** Where Bonum's hosted checkout sends the payer back. Query params are ignored: only our own status counts. */
export const load: PageServerLoad = async ({ locals, params, setHeaders, parent }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const invoice = await publicInvoice(locals.db, params.invoiceId);
	if (!invoice) error(404, { message: 'Payment not found', code: 'not_found' });
	const env = locals.config?.[invoice.provider]?.environment;
	const { brand } = await parent();
	// Only what this page shows: no QR or bank links here.
	return {
		invoice: { ...invoice, qr: null, deeplinks: [] },
		payee: payeeOf(invoice, brand),
		sandbox: env === 'test'
	};
};
