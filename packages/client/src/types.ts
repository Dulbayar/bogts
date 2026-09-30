/**
 * The public API shapes (docs/contracts.md "Public API shapes"). Every
 * timestamp is an ISO-8601 UTC string, every amount an integer in MNT.
 */

/** ISO-8601 UTC, e.g. `2026-09-25T14:05:32.000Z` */
export type IsoDate = string;

export type Provider = 'qpay' | 'bonum';
/** `qr`: a QR and bank-app links you show (QPay; Bonum's QR). `checkout`: the provider's hosted page (Bonum). */
export type InvoiceMethod = 'qr' | 'checkout';
export type Currency = 'MNT';
export type Metadata = Record<string, string>;

export interface List<T> {
	object: 'list';
	data: T[];
	hasMore: boolean;
	nextCursor: string | null;
}

/* ------------------------------------------------------------------ *
 * Invoices
 * ------------------------------------------------------------------ */

export type InvoiceStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';

/** A bank app link on a QR invoice. */
export interface Deeplink {
	name: string;
	description?: string;
	logo?: string;
	link: string;
}

export interface Invoice {
	id: string;
	object: 'invoice';
	provider: Provider;
	method: InvoiceMethod;
	status: InvoiceStatus;
	amount: number;
	currency: Currency;
	reference: string;
	description: string;
	/** Our hosted QR page for a `qr` invoice, Bonum's checkout for a `checkout` one */
	payUrl: string | null;
	redirectUrl: string | null;
	/** `qr` invoices only: the QR text and image (base64 PNG) */
	qr: { text: string; image: string | null } | null;
	deeplinks: Deeplink[];
	returnUrl: string | null;
	expiresAt: IsoDate;
	paidAt: IsoDate | null;
	metadata: Metadata | null;
	createdAt: IsoDate;
}

export interface CreateInvoiceInput {
	provider: Provider;
	/** QPay: `qr` only (the default). Bonum: `checkout` (the default) or `qr`. */
	method?: InvoiceMethod;
	/** Integer MNT */
	amount: number;
	reference: string;
	description: string;
	returnUrl?: string;
	/** Seconds, 60–86400, default 1800 */
	expiresIn?: number;
	metadata?: Metadata;
	/**
	 * Default true: if the project already has a pending, unexpired invoice for
	 * the same purchase (the same reference, provider, method, amount,
	 * description, returnUrl and metadata), that invoice is returned (HTTP 200, `reused:
	 * true`) instead of a new one (201). false always creates a new invoice.
	 * A reference should identify exactly one purchase (an order id).
	 */
	reuse?: boolean;
}

/** What `invoices.create` resolves with: the invoice, and whether it was handed back instead of created. */
export type CreatedInvoice = Invoice & {
	/** true: an existing pending invoice for the same purchase (HTTP 200, `Bogts-Reused: true`); false: a new one (201). */
	reused: boolean;
};

/* ------------------------------------------------------------------ *
 * Subscriptions
 * ------------------------------------------------------------------ */

export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'cancelled' | 'failed';

export interface Subscription {
	id: string;
	object: 'subscription';
	/** The plan key */
	plan: string;
	customerRef: string;
	email: string | null;
	status: SubscriptionStatus;
	/** Non-null only while pending, or while a card replacement is pending */
	redirectUrl: string | null;
	card: { mask: string; expiry: string | null; bank: string | null } | null;
	currentPeriod: { start: IsoDate; end: IsoDate } | null;
	nextBillAt: IsoDate | null;
	cancelledAt: IsoDate | null;
	createdAt: IsoDate;
}

export interface CreateSubscriptionInput {
	plan: string;
	customerRef: string;
	email?: string;
	returnUrl: string;
}

/* ------------------------------------------------------------------ *
 * Charges
 * ------------------------------------------------------------------ */

export type ChargeStatus = 'pending' | 'queued' | 'succeeded' | 'failed' | 'reversed';

export interface Charge {
	id: string;
	object: 'charge';
	status: ChargeStatus;
	amount: number;
	currency: Currency;
	reference: string;
	subscriptionId: string | null;
	/** A short machine code, never provider text */
	failureCode: string | null;
	createdAt: IsoDate;
}

export interface CreateChargeInput {
	/** Charges this subscription's saved card */
	subscriptionId: string;
	amount: number;
	reference: string;
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export const EVENT_TYPES = [
	'invoice.paid',
	'invoice.expired',
	'invoice.failed',
	'subscription.active',
	'subscription.renewed',
	'subscription.payment_failed',
	'subscription.cancelled',
	'subscription.card_changed',
	'charge.succeeded',
	'charge.failed',
	'charge.reversed'
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface Period {
	start: IsoDate;
	end: IsoDate;
}

export interface InvoiceEventData {
	invoiceId: string;
	provider: Provider;
	reference: string;
	amount: number;
	currency: Currency;
	/** invoice.paid */
	paidAt?: IsoDate;
	metadata?: Metadata | null;
	/**
	 * invoice.paid only: another invoice with the same `reference` was paid
	 * first (its id). The payer paid twice for one purchase: refund one.
	 */
	duplicateOfInvoiceId?: string;
}

export interface SubscriptionEventData {
	subscriptionId: string;
	/** The plan key */
	plan: string;
	customerRef: string;
	/** The amount charged (renewed / active with a first charge); absent otherwise */
	amount?: number;
	currency: Currency;
	period?: Period;
	nextBillAt?: IsoDate | null;
	/**
	 * subscription.cancelled: who ended it (`provider_cancelled`: reconciliation
	 * found it ended at Bonum). subscription.payment_failed: `payment_failed`,
	 * `checkout_failed` or `renewal_missing` (no renewal arrived for the period).
	 */
	reason?:
		| 'cancelled_by_project'
		| 'cancelled_by_admin'
		| 'retries_exhausted'
		| 'provider_cancelled'
		| 'payment_failed'
		| 'checkout_failed'
		| 'renewal_missing'
		| (string & {});
	/** subscription.card_changed / active: the card's display mask */
	cardMask?: string;
}

export interface ChargeEventData {
	chargeId: string;
	cardId: string;
	subscriptionId?: string | null;
	customerRef: string;
	reference: string;
	amount: number;
	currency: Currency;
	/** charge.failed: a short machine code, never provider text */
	failureCode?: string | null;
}

/** The `data` of each event type. */
export interface EventDataMap {
	'invoice.paid': InvoiceEventData;
	'invoice.expired': InvoiceEventData;
	'invoice.failed': InvoiceEventData;
	'subscription.active': SubscriptionEventData;
	'subscription.renewed': SubscriptionEventData;
	'subscription.payment_failed': SubscriptionEventData;
	'subscription.cancelled': SubscriptionEventData;
	'subscription.card_changed': SubscriptionEventData;
	'charge.succeeded': ChargeEventData;
	'charge.failed': ChargeEventData;
	'charge.reversed': ChargeEventData;
}

/** One event of type `T`: a webhook body and a feed item. */
export interface EventOf<T extends EventType> {
	id: string;
	object: 'event';
	type: T;
	createdAt: IsoDate;
	data: EventDataMap[T];
}

/**
 * Any event, as a discriminated union: `switch (event.type)` narrows `data`.
 * Act on each `event.id` once: delivery is at least once.
 */
export type BogtsEvent = { [T in EventType]: EventOf<T> }[EventType];

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export interface ListParams {
	/** 1–100, default 20 */
	limit?: number;
	/** `nextCursor` from the previous page */
	cursor?: string;
	/** Extra filters the endpoint supports */
	[filter: string]: string | number | boolean | undefined;
}

export interface EventListParams {
	limit?: number;
	/** Newest first (the default order): the previous page's `nextCursor` */
	cursor?: string;
	/** Oldest first, starting after this event id (the reconciliation feed) */
	after?: string;
	/** Only these types */
	type?: EventType | EventType[];
}

export interface RequestOptions {
	/** Sent as `Idempotency-Key` on POST; a random UUID when omitted */
	idempotencyKey?: string;
	signal?: AbortSignal;
}

/** The API's error body. */
export interface BogtsErrorBody {
	error: { code: string; message: string };
}
