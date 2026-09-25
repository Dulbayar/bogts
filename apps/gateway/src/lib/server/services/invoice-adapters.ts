/**
 * The registry of invoice adapters, one per provider. It lives apart from
 * `invoices.ts` (which re-exports it) so `settle.ts` can cancel a paid
 * purchase's other invoices without an import cycle.
 */
import { bonumInvoiceAdapter } from '../providers/bonum/invoice';
import { qpayInvoiceAdapter } from '../providers/qpay/invoice';
import type { Provider } from '../schema';
import type { InvoiceAdapter } from './invoice-adapter';

/** Every provider's invoice adapter. */
export const invoiceAdapters: Record<Provider, InvoiceAdapter> = {
	qpay: qpayInvoiceAdapter,
	bonum: bonumInvoiceAdapter
};
