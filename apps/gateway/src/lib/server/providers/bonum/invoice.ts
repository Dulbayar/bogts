/**
 * Bonum's two ways to take a one-off payment. `transactionId` is our invoice id
 * in both, so the `PAYMENT` webhook finds the row by it.
 *
 * `checkout`: the hosted (All-in-one) invoice — QPay, card, WeChat and the rest
 * on Bonum's checkout page. No `check()`: its status endpoint is test-only ("DO
 * NOT USE THIS SERVICE ON PRODUCTION"), so the expiry sweep expires these
 * locally, after a grace for late webhooks.
 *
 * `qr`: `qr/create`, a QPay-format QR and bank-app links the project shows
 * itself, as with a QPay invoice. These can be checked: the QR invoice lookup
 * (`transaction/qr`, by QR code) is a production endpoint and answers with the
 * invoice's status and amount, so the sweep asks once at expiry instead of
 * trusting that the webhook arrived.
 *
 * No `cancel()` for either: Bonum has no cancel endpoint; an unpaid invoice
 * simply expires on its side after `expiresIn`.
 */
import type { InvoiceAdapter } from '../../services/invoice-adapter';
import { nowOf } from '../../services/context';
import { toMnt } from '../../money';
import { deeplinks, qrImage, qrText } from '../../qr';
import type { Invoice } from '../../schema';
import { bonumConfigOf, bonumRequest, BonumError, unwrap } from './client';
import { bonumItem, checkedFollowUpLink } from './util';

const MIN_EXPIRES_IN = 60;

const expiresInOf = (ctx: Parameters<InvoiceAdapter['create']>[0], invoice: Invoice) =>
	Math.max(MIN_EXPIRES_IN, Math.ceil((invoice.expiresAt - nowOf(ctx)) / 1000));

const idOf = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

export const bonumInvoiceAdapter: InvoiceAdapter = {
	async create(ctx, invoice) {
		bonumConfigOf(ctx);
		if (invoice.method === 'qr') {
			const body = await bonumRequest(ctx, 'qr/create', '/mpay-service/merchant/transaction/qr/create', {
				method: 'POST',
				body: { amount: invoice.amount, transactionId: invoice.id, expiresIn: expiresInOf(ctx, invoice) }
			});
			const data = unwrap(body);
			const providerInvoiceId = idOf(data.invoiceId);
			const text = qrText(data.qrCode);
			// Without the QR there is nothing to show the payer, and nothing to check later.
			if (!providerInvoiceId || !text) throw new BonumError(502, 'qr/create', 'invalid_response');
			return {
				providerInvoiceId,
				qrText: text,
				qrImage: qrImage(data.qrImage),
				deeplinks: deeplinks(data.links)
			};
		}
		const origin = ctx.config.publicOrigin!;
		const body = await bonumRequest(ctx, 'invoices/create', '/bonum-gateway/ecommerce/invoices', {
			method: 'POST',
			body: {
				amount: invoice.amount,
				callback: `${origin}/return/${encodeURIComponent(invoice.id)}`,
				transactionId: invoice.id,
				expiresIn: expiresInOf(ctx, invoice),
				items: [bonumItem(invoice.description, invoice.amount)]
			}
		});
		const data = unwrap(body);
		const providerInvoiceId = idOf(data.invoiceId);
		if (!providerInvoiceId) throw new BonumError(502, 'invoices/create', 'invalid_response');
		return { providerInvoiceId, redirectUrl: checkedFollowUpLink(data.followUpLink, 'invoices/create') };
	},

	/**
	 * QR invoices only; the sweep never calls this for a hosted checkout. The
	 * ledger reference is the id `qr/create` gave us, never the lookup's own
	 * numeric id, so this and a late `PAYMENT` webhook record one payment.
	 */
	async check(ctx, invoice) {
		if (invoice.method !== 'qr' || !invoice.qrText || !invoice.providerInvoiceId) return { paid: false };
		const body = await bonumRequest(ctx, 'qr/lookup', '/mpay-service/merchant/transaction/qr', {
			method: 'POST',
			body: { qrCode: invoice.qrText }
		});
		const found = unwrap(body).invoice;
		if (!found || typeof found !== 'object') return { paid: false };
		const inv = found as Record<string, unknown>;
		if (String(inv.status ?? '').toUpperCase() !== 'PAID') return { paid: false };
		let amount: number;
		try {
			amount = toMnt(inv.amount as number | string);
		} catch {
			throw new BonumError(502, 'qr/lookup', 'invalid_amount');
		}
		// The lookup has no payment time; the check is what noticed it.
		return { paid: true, providerRef: invoice.providerInvoiceId, amount, paidAt: nowOf(ctx) };
	}
};
