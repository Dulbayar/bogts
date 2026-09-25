import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../../../../routes/hooks/qpay/[invoiceId]/+server';
import { activity, event, invoice, ledger } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { openInvoice } from '../../services/invoices';
import { endInvoice } from '../../services/settle';
import { createTestDb, seedProject, testConfig, type TestDb } from '../../testdb';
import { CALLBACK_CHECKS_PER_WINDOW, PAID_RECHECK_WINDOW_MS, PAID_RECHECKS_PER_WINDOW, processQpayCallback } from './callback';
import { resetQpayTokenCache } from './client';
import { fakeQpay, type FakeQpay } from './fake';

let db: TestDb;
let ctx: ServiceContext;
let qpay: FakeQpay;
let projectId: string;

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

beforeEach(async () => {
	resetQpayTokenCache();
	db = createTestDb();
	projectId = (await seedProject(db)).project.id;
	ctx = { db, config: testConfig(), now: NOW };
	qpay = fakeQpay();
	vi.stubGlobal('fetch', qpay.fetch);
});
afterEach(() => vi.unstubAllGlobals());

const newInvoice = async () =>
	(await openInvoice(ctx, { id: projectId }, { provider: 'qpay', amount: 49_900, reference: 'order-1', description: 'Pro' })).invoice;

async function current(id: string) {
	const [row] = await db.select().from(invoice).where(eq(invoice.id, id));
	return row!;
}
const kinds = async () => (await db.select().from(activity)).map((a) => a.kind);

/** Calls the route the way SvelteKit would, with a hostile body. */
function hit(invoiceId: string, method: 'GET' | 'POST' = 'POST') {
	const url = new URL(`https://payments.test/hooks/qpay/${invoiceId}?qpay_payment_id=forged`);
	const request = new Request(url, {
		method,
		body: method === 'POST' ? JSON.stringify({ payment_status: 'PAID', amount: 49_900 }) : undefined
	});
	const locals = { db, config: ctx.config, waitUntil: () => {} };
	const e = { url, request, params: { invoiceId }, locals } as unknown as RequestEvent<{ invoiceId: string }>;
	return (method === 'GET' ? GET : POST)(e as never);
}

describe('QPay callback', () => {
	it('settles a payment verified with payment/check', async () => {
		const inv = await newInvoice();
		const paymentId = qpay.pay(inv.providerInvoiceId!, 49_900);
		const res = await hit(inv.id);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('SUCCESS');
		expect(await current(inv.id)).toMatchObject({ status: 'paid', providerTransactionId: paymentId });
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.paid']);
		expect(await kinds()).toContain('qpay.callback.paid');
	});

	it('ignores a spoofed callback: unpaid at re-check', async () => {
		const inv = await newInvoice();
		const res = await hit(inv.id, 'GET');
		expect(res.status).toBe(200);
		expect((await current(inv.id)).status).toBe('pending');
		expect(await db.select().from(ledger)).toHaveLength(0);
		expect(await db.select().from(event)).toHaveLength(0);
		expect(await kinds()).toContain('qpay.callback.unverified');
	});

	it('is idempotent on a replay: it may look again, but settles nothing twice', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 49_900);
		await hit(inv.id);
		const checks = qpay.count('POST /v2/payment/check');
		const res = await hit(inv.id);
		expect(res.status).toBe(200);
		expect(qpay.count('POST /v2/payment/check')).toBe(checks + 1);
		expect(await db.select().from(ledger)).toHaveLength(1);
		expect(await db.select().from(event)).toHaveLength(1);
	});

	it('records a duplicate when two callbacks race', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 49_900);
		const outcomes = await Promise.all([processQpayCallback(ctx, inv.id), processQpayCallback(ctx, inv.id)]);
		expect(outcomes.sort()).toEqual(['duplicate', 'settled']);
		expect(await db.select().from(ledger)).toHaveLength(1);
	});

	it('does not settle a different amount', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 100);
		expect((await hit(inv.id)).status).toBe(200);
		expect((await current(inv.id)).status).toBe('pending');
		expect(await db.select().from(ledger)).toHaveLength(0);
		expect(await kinds()).toEqual(expect.arrayContaining(['qpay.payment.amount_mismatch', 'qpay.callback.unverified']));
	});

	it('honours a payment that arrives after expiry', async () => {
		const inv = await newInvoice();
		await endInvoice(ctx, inv, 'expired', { swept: true });
		qpay.pay(inv.providerInvoiceId!, 49_900);
		expect((await hit(inv.id)).status).toBe(200);
		expect((await current(inv.id)).status).toBe('paid');
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.expired', 'invoice.paid']);
		const [paid] = await db.select().from(activity).where(eq(activity.kind, 'qpay.callback.paid'));
		expect(paid?.summary).toContain('expired');
	});

	it('answers 503 so QPay retries when the check fails', async () => {
		const inv = await newInvoice();
		qpay.failures.set('POST /v2/payment/check', { status: 500 });
		const res = await hit(inv.id);
		expect(res.status).toBe(503);
		expect(res.headers.get('retry-after')).toBe('60');
		expect(await kinds()).toContain('qpay.callback.check_failed');
	});

	it('404s unknown and malformed ids without calling QPay', async () => {
		expect((await hit('01J00000000000000000000000')).status).toBe(404);
		expect((await hit('not-an-id')).status).toBe(404);
		expect(qpay.count('POST /v2/payment/check')).toBe(0);
	});

	it('throttles re-checks per invoice', async () => {
		const inv = await newInvoice();
		for (let i = 0; i < CALLBACK_CHECKS_PER_WINDOW; i++) await processQpayCallback(ctx, inv.id);
		expect(await processQpayCallback(ctx, inv.id)).toBe('throttled');
		expect(qpay.count('POST /v2/payment/check')).toBe(CALLBACK_CHECKS_PER_WINDOW);
	});

	it('trusts nothing in the request: a forged payment id, amount or header settles only what payment/check says', async () => {
		const inv = await newInvoice();
		const { invoice: other } = await openInvoice(ctx, { id: projectId }, { provider: 'qpay', amount: 1, reference: 'order-x', description: 'x' });
		const otherPayment = qpay.pay(other.providerInvoiceId!, 1);
		const url = new URL(`https://payments.test/hooks/qpay/${inv.id}?qpay_payment_id=${otherPayment}&payment_id=${otherPayment}&amount=1`);
		const forged = (method: 'GET' | 'POST') =>
			new Request(url, {
				method,
				headers: { 'content-type': 'application/json', 'x-qpay-payment-id': otherPayment, 'x-payment-status': 'PAID' },
				body: method === 'POST' ? JSON.stringify({ payment_id: otherPayment, payment_status: 'PAID', payment_amount: '49900.00', qpay_payment_id: otherPayment }) : undefined
			});
		const call = (method: 'GET' | 'POST') => {
			const locals = { db, config: ctx.config, waitUntil: () => {} };
			const e = { url, request: forged(method), params: { invoiceId: inv.id }, locals } as unknown as RequestEvent<{ invoiceId: string }>;
			return (method === 'GET' ? GET : POST)(e as never);
		};
		// Unpaid at QPay: nothing is settled, whatever the request claims.
		expect((await call('POST')).status).toBe(200);
		expect((await call('GET')).status).toBe(200);
		expect((await current(inv.id)).status).toBe('pending');
		expect(await db.select().from(ledger)).toHaveLength(0);
		// Paid at QPay: settled with QPay's payment id and amount, never the forged ones.
		const real = qpay.pay(inv.providerInvoiceId!, 49_900);
		expect((await call('POST')).status).toBe(200);
		expect(await current(inv.id)).toMatchObject({ status: 'paid', providerTransactionId: real });
		expect(await db.select().from(ledger)).toMatchObject([{ providerRef: real, amount: 49_900, subjectId: inv.id }]);
		expect((await current(other.id)).status).toBe('pending');
	});

	it('settles the first of two PAID payments once and records the extra one', async () => {
		const inv = await newInvoice();
		const first = qpay.pay(inv.providerInvoiceId!, 49_900);
		const second = qpay.pay(inv.providerInvoiceId!, 49_900);
		expect(await processQpayCallback(ctx, inv.id)).toBe('settled');
		expect(await current(inv.id)).toMatchObject({ status: 'paid', providerTransactionId: first });
		expect(await db.select().from(ledger)).toHaveLength(1);
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.paid']);
		const extra = await db.select().from(activity).where(eq(activity.kind, 'qpay.extra_payment'));
		expect(extra).toHaveLength(1);
		expect(extra[0]!.summary).toContain(`${second} (49900 MNT)`);
		// Later callbacks for the paid invoice look again, but record the same finding once.
		await processQpayCallback({ ...ctx, now: NOW + PAID_RECHECK_WINDOW_MS }, inv.id);
		expect(await db.select().from(activity).where(eq(activity.kind, 'qpay.extra_payment'))).toHaveLength(1);
		expect(await db.select().from(event)).toHaveLength(1);
	});

	it('finds a second payment on an invoice already paid, at most 3 re-checks per window', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 49_900);
		expect(await processQpayCallback(ctx, inv.id)).toBe('settled');
		const checks = qpay.count('POST /v2/payment/check');
		const second = qpay.pay(inv.providerInvoiceId!, 49_900);
		// Right after the settling callback: settling used no re-check, so the next callback looks.
		expect(await processQpayCallback({ ...ctx, now: NOW + 1000 }, inv.id)).toBe('already_paid');
		expect(qpay.count('POST /v2/payment/check')).toBe(checks + 1);
		const [extra] = await db.select().from(activity).where(eq(activity.kind, 'qpay.extra_payment'));
		expect(extra!.summary).toContain(second);
		// Two more in the window, then no more QPay calls until it passes.
		for (let i = 0; i < 4; i++) expect(await processQpayCallback({ ...ctx, now: NOW + 2000 + i }, inv.id)).toBe('already_paid');
		expect(qpay.count('POST /v2/payment/check')).toBe(checks + PAID_RECHECKS_PER_WINDOW);
		expect(await processQpayCallback({ ...ctx, now: NOW + 1000 + PAID_RECHECK_WINDOW_MS }, inv.id)).toBe('already_paid');
		expect(qpay.count('POST /v2/payment/check')).toBe(checks + PAID_RECHECKS_PER_WINDOW + 1);
		expect(await db.select().from(activity).where(eq(activity.kind, 'qpay.extra_payment'))).toHaveLength(1);
		expect(await db.select().from(ledger)).toHaveLength(1);
		expect(await db.select().from(event)).toHaveLength(1);
	});

	it('records a refunded payment and keeps the invoice paid', async () => {
		const inv = await newInvoice();
		const paid = qpay.pay(inv.providerInvoiceId!, 49_900);
		await processQpayCallback(ctx, inv.id);
		qpay.payments.get(inv.providerInvoiceId!)![0]!.payment_status = 'REFUNDED';
		expect(await processQpayCallback({ ...ctx, now: NOW + PAID_RECHECK_WINDOW_MS }, inv.id)).toBe('already_paid');
		expect((await current(inv.id)).status).toBe('paid');
		const [refunded] = await db.select().from(activity).where(eq(activity.kind, 'qpay.payment_refunded'));
		expect(refunded!.summary).toContain(`${paid} as REFUNDED`);
		expect(await db.select().from(ledger)).toHaveLength(1);
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.paid']);
	});

	it('a failing re-check of a paid invoice still answers SUCCESS', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 49_900);
		await processQpayCallback(ctx, inv.id);
		qpay.failures.set('POST /v2/payment/check', { status: 500 });
		expect(await processQpayCallback({ ...ctx, now: NOW + PAID_RECHECK_WINDOW_MS }, inv.id)).toBe('already_paid');
	});
});
