import { error } from '@sveltejs/kit';
import { publicInvoice } from '$lib/server/public/invoice-view';
import type { PageServerLoad } from './$types';

/** Where Bonum's hosted checkout sends the payer back. Query params are ignored: only our own status counts. */
export const load: PageServerLoad = async ({ locals, params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const invoice = await publicInvoice(locals.db, params.invoiceId);
	if (!invoice) error(404, { message: 'Payment not found', code: 'not_found' });
	const env = locals.config?.[invoice.provider]?.environment;
	// Only what this page shows: no QR or bank links here.
	return {
		invoice: { ...invoice, qr: null, deeplinks: [] },
		sandbox: env === 'test'
	};
};
