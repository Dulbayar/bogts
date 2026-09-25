/**
 * QPay one-off invoices: a QR, bank deeplinks, `payment/check` and cancel.
 *
 * - `sender_invoice_no` is OUR invoice id and the callback URL carries it too
 *   (`/hooks/qpay/<invoiceId>`), so a callback names exactly one row.
 * - `check` is the ONLY proof of payment. It counts a row as paid only when its
 *   `payment_status` is `PAID` and its amount equals the invoice amount; the
 *   first such row's QPay `payment_id` becomes the ledger's providerRef. PAID
 *   money of a different amount is not settled: it is recorded as activity for
 *   a person to look at (the invoice's amount is the contract with the
 *   project). A second PAID row (`qpay.extra_payment`) and a settled payment
 *   QPay now returns with another status (`qpay.payment_refunded`) are
 *   recorded too. Every note is best effort: a D1 failure while writing one
 *   never makes `check` throw or changes its answer.
 * - `cancel` is best effort. An invoice QPay already cancelled or forgot counts
 *   as cancelled; a QR that stays payable anyway is still honoured by
 *   `settleInvoice` if money arrives.
 */
import { and, eq } from 'drizzle-orm';
import { recordActivity } from '../../activity';
import { ApiError } from '../../api/errors';
import { toMnt } from '../../money';
import { activity, type Deeplink, type Invoice } from '../../schema';
import { nowOf, type ServiceContext } from '../../services/context';
import type { InvoiceAdapter } from '../../services/invoice-adapter';
import { QpayCallError, qpayCall } from './client';

/** QPay's `qr_image` is a base64 PNG of about 10 KB; anything much larger is dropped. */
export const MAX_QR_IMAGE_CHARS = 48 * 1024;
const MAX_QR_TEXT_CHARS = 2048;
const MAX_DEEPLINKS = 50;
/** QPay's invoice_description limit is not documented; 255 is what every client uses. */
const MAX_DESCRIPTION = 255;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function callbackUrl(origin: string, invoiceId: string): string {
	return `${origin}/hooks/qpay/${encodeURIComponent(invoiceId)}`;
}

const str = (v: unknown, max: number): string | undefined =>
	typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

/** QPay's `urls[]`, checked rather than trusted. */
function deeplinks(raw: unknown): Deeplink[] {
	if (!Array.isArray(raw)) return [];
	const out: Deeplink[] = [];
	for (const item of raw.slice(0, MAX_DEEPLINKS)) {
		if (!item || typeof item !== 'object') continue;
		const r = item as Record<string, unknown>;
		const name = str(r.name, 200);
		const link = str(r.link, 4096);
		if (!name || !link || /^\s*(javascript|data|vbscript):/i.test(link)) continue;
		const d: Deeplink = { name, link };
		const description = str(r.description, 200);
		const logo = str(r.logo, 2048);
		if (description) d.description = description;
		if (logo && /^https:\/\//i.test(logo)) d.logo = logo;
		out.push(d);
	}
	return out;
}

function qrImage(raw: unknown): string | null {
	if (typeof raw !== 'string' || !raw || raw.length > MAX_QR_IMAGE_CHARS) return null;
	return BASE64.test(raw) ? raw : null;
}

function disabled(): ApiError {
	return new ApiError(400, 'provider_disabled', 'QPay is not enabled on this gateway');
}

/** One `payment/check` row, read defensively. `amount` is null when unreadable. */
export type PaymentRow = { paymentId: string; status: string; amount: number | null };

/** The payment/check rows for a QPay invoice (first page of 100). */
export async function paymentRows(ctx: ServiceContext, providerInvoiceId: string): Promise<PaymentRow[]> {
	const data = await qpayCall(ctx, 'payment/check', (client) =>
		client.checkPayment({
			objectType: 'INVOICE',
			objectId: providerInvoiceId,
			offset: { pageNumber: 1, pageLimit: 100 }
		})
	);
	const raw: unknown[] = Array.isArray(data?.rows) ? data.rows : [];
	const out: PaymentRow[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const paymentId = typeof row.paymentId === 'number' ? String(row.paymentId) : str(row.paymentId, 128);
		if (!paymentId) continue;
		let amount: number | null;
		try {
			amount = toMnt(row.paymentAmount as string | number);
		} catch {
			amount = null;
		}
		out.push({ paymentId, status: typeof row.paymentStatus === 'string' ? row.paymentStatus.toUpperCase() : '', amount });
	}
	return out;
}

/** Only short, plain tokens from QPay reach the activity text. */
const token = (v: string) => (/^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : '?');

/**
 * Records an activity row. Never throws: `check` is the proof of payment, and
 * a failing note (D1) must never make it throw or change its answer.
 */
async function note(ctx: ServiceContext, invoice: Invoice, kind: string, summary: string, opts: { once?: boolean } = {}): Promise<void> {
	try {
		if (opts.once) {
			// The same kind and text for the same invoice is not repeated.
			const [seen] = await ctx.db
				.select({ id: activity.id })
				.from(activity)
				.where(and(eq(activity.subjectType, 'invoice'), eq(activity.subjectId, invoice.id), eq(activity.kind, kind), eq(activity.summary, summary)))
				.limit(1);
			if (seen) return;
		}
		await recordActivity(
			ctx.db,
			{ projectId: invoice.projectId, subjectType: 'invoice', subjectId: invoice.id, source: 'provider', kind, summary },
			nowOf(ctx)
		);
	} catch {
		/* the timeline is best effort; the check's answer is what matters */
	}
}

/**
 * What else payment/check says about an invoice besides "paid or not":
 *  - more than one PAID row: the payer paid the same QR twice. Only one is
 *    ever settled (`settledRef`); the others are `qpay.extra_payment` for a
 *    person to refund. No second `invoice.paid`.
 *  - QPay returns the payment an invoice was settled with, with a status
 *    other than PAID (e.g. REFUNDED): `qpay.payment_refunded`. A missing row
 *    or an empty answer records nothing (QPay may page or omit rows). The
 *    invoice stays paid: Bogts reports money that moved, and a refund is the
 *    merchant's own act.
 * Each is recorded once per distinct finding. Never throws.
 */
async function reviewPayments(ctx: ServiceContext, invoice: Invoice, rows: PaymentRow[], settledRef: string | null): Promise<void> {
	if (!settledRef) return;
	const extra = rows.filter((r) => r.status === 'PAID' && r.paymentId !== settledRef);
	if (extra.length) {
		const list = extra.map((r) => `${token(r.paymentId)} (${r.amount ?? '?'} MNT)`).join(', ');
		await note(
			ctx,
			invoice,
			'qpay.extra_payment',
			`QPay reports ${extra.length === 1 ? 'another PAID payment' : `${extra.length} more PAID payments`} for this invoice: ${list}. Settled once only; refund the extra.`,
			{ once: true }
		);
	}
	if (invoice.status === 'paid') {
		const settled = rows.find((r) => r.paymentId === settledRef);
		if (settled && settled.status && settled.status !== 'PAID') {
			await note(
				ctx,
				invoice,
				'qpay.payment_refunded',
				`QPay now reports payment ${token(settledRef)} as ${token(settled.status)}. The invoice stays paid; check the QPay merchant portal.`,
				{ once: true }
			);
		}
	}
}

export const qpayInvoiceAdapter: InvoiceAdapter = {
	async create(ctx, invoice) {
		const cfg = ctx.config.qpay;
		const origin = ctx.config.publicOrigin;
		if (!cfg || !origin) throw disabled();
		const data = await qpayCall(ctx, 'invoice', (client) =>
			client.createSimpleInvoice({
				invoiceCode: cfg.invoiceCode,
				senderInvoiceNo: invoice.id,
				invoiceReceiverCode: 'terminal',
				invoiceDescription: invoice.description.slice(0, MAX_DESCRIPTION),
				amount: invoice.amount,
				callbackUrl: callbackUrl(origin, invoice.id)
			})
		);
		// The types promise these fields; the wire does not.
		const providerInvoiceId = str(data?.invoiceId, 128);
		if (!providerInvoiceId) throw new QpayCallError(200, 'bad_response', 'invoice');
		return {
			providerInvoiceId,
			qrText: str(data.qrText, MAX_QR_TEXT_CHARS) ?? null,
			qrImage: qrImage(data.qrImage),
			deeplinks: deeplinks(data.urls)
		};
	},

	async check(ctx, invoice) {
		if (!invoice.providerInvoiceId) return { paid: false };
		const rows = await paymentRows(ctx, invoice.providerInvoiceId);
		const paid = rows.filter((r) => r.status === 'PAID' && r.amount !== null);
		const match = paid.find((r) => r.amount === invoice.amount);
		// The payment this invoice is (or is about to be) settled with.
		const settledRef = invoice.status === 'paid' ? invoice.providerTransactionId : null;
		await reviewPayments(ctx, invoice, rows, settledRef ?? match?.paymentId ?? null);
		if (match) return { paid: true, providerRef: match.paymentId, amount: match.amount!, paidAt: nowOf(ctx) };
		const mismatched = paid[paid.length - 1];
		if (mismatched && invoice.status !== 'paid') {
			await note(
				ctx,
				invoice,
				'qpay.payment.amount_mismatch',
				`QPay reports a paid amount of ${mismatched.amount} MNT, but the invoice is for ${invoice.amount} MNT. Not settled; check the QPay merchant portal.`
			);
		}
		return { paid: false };
	},

	async cancel(ctx, invoice: Invoice) {
		if (!invoice.providerInvoiceId) return;
		const id = invoice.providerInvoiceId;
		try {
			await qpayCall(ctx, 'invoice/cancel', (client) => client.cancelInvoice(encodeURIComponent(id)));
		} catch (err) {
			// Already cancelled, or QPay no longer knows it: the goal is reached.
			if (err instanceof QpayCallError && (err.code === 'INVOICE_ALREADY_CANCELED' || err.status === 404)) return;
			throw err;
		}
	}
};
