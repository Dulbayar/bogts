/**
 * Bonum's hosted (All-in-one) invoice: QPay, card, WeChat and SonoShop on
 * Bonum's checkout page. `transactionId` is our invoice id, so the `PAYMENT`
 * webhook finds the row by it.
 *
 * No `check()`: Bonum's invoice-status endpoint is test-only ("DO NOT USE THIS
 * SERVICE ON PRODUCTION"), so the expiry sweep expires Bonum invoices locally.
 * No `cancel()` either: Bonum has no cancel endpoint; an unpaid invoice simply
 * expires on its side after `expiresIn`.
 */
import type { InvoiceAdapter } from '../../services/invoice-adapter';
import { nowOf } from '../../services/context';
import { bonumConfigOf, bonumRequest, BonumError, unwrap } from './client';
import { bonumItem, checkedFollowUpLink } from './util';

const MIN_EXPIRES_IN = 60;

export const bonumInvoiceAdapter: InvoiceAdapter = {
	async create(ctx, invoice) {
		bonumConfigOf(ctx);
		const origin = ctx.config.publicOrigin!;
		const expiresIn = Math.max(MIN_EXPIRES_IN, Math.ceil((invoice.expiresAt - nowOf(ctx)) / 1000));
		const body = await bonumRequest(ctx, 'invoices/create', '/bonum-gateway/ecommerce/invoices', {
			method: 'POST',
			body: {
				amount: invoice.amount,
				callback: `${origin}/return/${encodeURIComponent(invoice.id)}`,
				transactionId: invoice.id,
				expiresIn,
				items: [bonumItem(invoice.description, invoice.amount)]
			}
		});
		const data = unwrap(body);
		const providerInvoiceId =
			typeof data.invoiceId === 'string' || typeof data.invoiceId === 'number' ? String(data.invoiceId) : '';
		if (!providerInvoiceId) throw new BonumError(502, 'invoices/create', 'invalid_response');
		return { providerInvoiceId, redirectUrl: checkedFollowUpLink(data.followUpLink, 'invoices/create') };
	}
};
