import type { Deeplink, Invoice } from '../schema';
import type { ServiceContext } from './context';

/**
 * What a provider must do for one-off invoices. `services/invoices.ts` inserts
 * the invoice row first, then calls `create`, then stores what it returns.
 * Settlement never happens here: providers call `settleInvoice` from
 * `services/settle.ts` when their webhook, callback or check proves payment.
 */
export interface InvoiceAdapter {
	create(ctx: ServiceContext, invoice: Invoice): Promise<{
		providerInvoiceId: string;
		redirectUrl?: string | null;
		qrText?: string | null;
		qrImage?: string | null;
		deeplinks?: Deeplink[] | null;
	}>;
	/**
	 * Asks the provider whether the invoice was paid. Used once by the expiry
	 * sweep. A provider with no production status API (Bonum) omits it, and the
	 * sweep then expires the invoice locally.
	 */
	check?(
		ctx: ServiceContext,
		invoice: Invoice
	): Promise<{ paid: true; providerRef: string; amount: number; paidAt: number } | { paid: false }>;
	/** Best-effort provider-side cancel of an unpaid invoice. */
	cancel?(ctx: ServiceContext, invoice: Invoice): Promise<void>;
}
