import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { fakeBonum, jsonResponse } from '../providers/bonum/testing';
import { resetQpayTokenCache } from '../providers/qpay/client';
import { fakeQpay, type FakeQpay } from '../providers/qpay/fake';
import { activity, event, invoice, ledger } from '../schema';
import { createTestDb, seedProject, testConfig, type TestDb } from '../testdb';
import type { ServiceContext } from './context';
import { cancelInvoice, getInvoice, invoiceJson, listInvoices, openInvoice, REUSE_MIN_REMAINING_MS } from './invoices';
import { sweepExpired } from '../sweep';
import { endInvoice, settleInvoice } from './settle';

/** A new (or reused) invoice row, via openInvoice. */
const newInvoice = async (...args: Parameters<typeof openInvoice>) => (await openInvoice(...args)).invoice;

let db: TestDb;
let ctx: ServiceContext;
let qpay: FakeQpay;
let projectId: string;

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const input = { provider: 'qpay' as const, amount: 49_900, reference: 'order-1', description: 'Pro plan' };

beforeEach(async () => {
	resetQpayTokenCache();
	db = createTestDb();
	projectId = (await seedProject(db)).project.id;
	ctx = { db, config: testConfig(), now: NOW };
	qpay = fakeQpay();
	vi.stubGlobal('fetch', qpay.fetch);
});
afterEach(() => vi.unstubAllGlobals());

const codeOf = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof ApiError ? `${e.status} ${e.code}` : String(e)));

describe('openInvoice: a new invoice', () => {
	it('inserts, creates at QPay and stores the QR', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, { ...input, metadata: { plan: 'pro' }, returnUrl: 'https://shop.test/done' });
		expect(inv).toMatchObject({
			status: 'pending',
			providerInvoiceId: `qp-${inv.id}`,
			qrText: `QRTEXT-qp-${inv.id}`,
			expiresAt: NOW + 1800 * 1000,
			metadata: { plan: 'pro' },
			returnUrl: 'https://shop.test/done'
		});
		const json = invoiceJson(inv, ctx.config);
		expect(json).toMatchObject({
			object: 'invoice',
			provider: 'qpay',
			currency: 'MNT',
			payUrl: `https://payments.test/pay/${inv.id}`,
			redirectUrl: null,
			qr: { text: `QRTEXT-qp-${inv.id}`, image: 'iVBORw0KGgoAAAANSUhEUg==' },
			expiresAt: new Date(NOW + 1_800_000).toISOString(),
			paidAt: null,
			createdAt: new Date(NOW).toISOString()
		});
		expect(json.deeplinks).toHaveLength(1);
	});

	it('honours expiresIn and validates it', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, { ...input, expiresIn: 60 });
		expect(inv.expiresAt).toBe(NOW + 60_000);
		expect(await codeOf(newInvoice(ctx, { id: projectId }, { ...input, expiresIn: 59 }))).toBe('400 invalid_request');
		expect(await codeOf(newInvoice(ctx, { id: projectId }, { ...input, expiresIn: 86_401 }))).toBe('400 invalid_request');
	});

	it.each([0, -1, 1.5, 1_000_000_001])('refuses amount %s', async (amount) => {
		expect(await codeOf(newInvoice(ctx, { id: projectId }, { ...input, amount }))).toBe('400 invalid_request');
		expect(await db.select().from(invoice)).toHaveLength(0);
	});

	it('refuses a disabled provider', async () => {
		ctx = { ...ctx, config: testConfig({ qpay: null, providers: { bonum: true, qpay: false } }) };
		expect(await codeOf(newInvoice(ctx, { id: projectId }, input))).toBe('400 provider_disabled');
		expect(qpay.calls).toHaveLength(0);
	});

	it('marks the invoice failed and answers provider_error when QPay fails', async () => {
		qpay.failures.set('POST /v2/invoice', { status: 500 });
		expect(await codeOf(newInvoice(ctx, { id: projectId }, input))).toBe('502 provider_error');
		const [row] = await db.select().from(invoice);
		expect(row?.status).toBe('failed');
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.failed']);
		const [a] = await db.select().from(activity);
		expect(a?.kind).toBe('invoice.create_failed');
		expect(a?.summary).not.toContain('secret upstream body');
	});

	it('routes Bonum invoices to the hosted checkout adapter', async () => {
		fakeBonum({
			'POST /bonum-gateway/ecommerce/invoices': () =>
				jsonResponse({ invoiceId: 'bonum-inv-1', followUpLink: 'https://ecommerce.bonum.mn/ecommerce?invoiceId=bonum-inv-1' })
		});
		const created = await newInvoice(ctx, { id: projectId }, { ...input, provider: 'bonum' });
		expect(created).toMatchObject({ provider: 'bonum', status: 'pending', providerInvoiceId: 'bonum-inv-1', redirectUrl: 'https://ecommerce.bonum.mn/ecommerce?invoiceId=bonum-inv-1' });
	});

	it('marks a Bonum invoice failed when Bonum refuses it', async () => {
		fakeBonum({ 'POST /bonum-gateway/ecommerce/invoices': () => jsonResponse({ message: 'nope' }, 500) });
		expect(await codeOf(newInvoice(ctx, { id: projectId }, { ...input, provider: 'bonum' }))).toBe('502 provider_error');
		const [row] = await db.select().from(invoice);
		expect(row?.status).toBe('failed');
	});
});

describe('getInvoice / listInvoices', () => {
	it('scopes to the project', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, input);
		const other = (await seedProject(db)).project.id;
		expect((await getInvoice(ctx, projectId, inv.id)).id).toBe(inv.id);
		expect(await codeOf(getInvoice(ctx, other, inv.id))).toBe('404 not_found');
		expect(await codeOf(getInvoice(ctx, projectId, 'nope'))).toBe('404 not_found');
	});

	it('pages newest first and filters by reference and status', async () => {
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) ids.push((await newInvoice(ctx, { id: projectId }, { ...input, reference: i % 2 ? 'odd' : 'even', reuse: false })).id);
		const first = await listInvoices(ctx, projectId, { limit: 2 });
		expect(first.data.map((i) => i.id)).toEqual([ids[4], ids[3]]);
		expect(first).toMatchObject({ hasMore: true, nextCursor: ids[3] });
		const rest = await listInvoices(ctx, projectId, { limit: 10, cursor: first.nextCursor! });
		expect(rest.data.map((i) => i.id)).toEqual([ids[2], ids[1], ids[0]]);
		expect(rest).toMatchObject({ hasMore: false, nextCursor: null });
		expect((await listInvoices(ctx, projectId, { reference: 'odd' })).data).toHaveLength(2);
		expect((await listInvoices(ctx, projectId, { status: 'paid' })).data).toHaveLength(0);
		expect(await codeOf(listInvoices(ctx, projectId, { cursor: 'bad' }))).toBe('400 invalid_request');
		// A lowercased cursor continues from the same place.
		const lower = await listInvoices(ctx, projectId, { limit: 10, cursor: first.nextCursor!.toLowerCase() });
		expect(lower.data.map((i) => i.id)).toEqual([ids[2], ids[1], ids[0]]);
	});
});

describe('cancelInvoice', () => {
	it('cancels an unpaid invoice at QPay and locally', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, input);
		const out = await cancelInvoice(ctx, projectId, inv.id);
		expect(out.status).toBe('cancelled');
		expect(qpay.count('POST /v2/payment/check')).toBe(1);
		expect(qpay.count('DELETE /v2/invoice/:id')).toBe(1);
		expect(await codeOf(cancelInvoice(ctx, projectId, inv.id))).toBe('409 conflict');
	});

	it('settles instead when the invoice turns out paid', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, input);
		qpay.pay(inv.providerInvoiceId!, 49_900);
		expect(await codeOf(cancelInvoice(ctx, projectId, inv.id))).toBe('409 conflict');
		expect((await getInvoice(ctx, projectId, inv.id)).status).toBe('paid');
		expect(await db.select().from(ledger)).toHaveLength(1);
		expect(qpay.count('DELETE /v2/invoice/:id')).toBe(0);
	});

	it('refuses to cancel when QPay cannot say whether it was paid', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, input);
		qpay.failures.set('POST /v2/payment/check', { status: 503 });
		expect(await codeOf(cancelInvoice(ctx, projectId, inv.id))).toBe('502 provider_error');
		expect((await getInvoice(ctx, projectId, inv.id)).status).toBe('pending');
	});

	it('still cancels locally when the QPay cancel fails, and notes it', async () => {
		const inv = await newInvoice(ctx, { id: projectId }, input);
		qpay.failures.set('DELETE /v2/invoice/:id', { status: 500 });
		expect((await cancelInvoice(ctx, projectId, inv.id)).status).toBe('cancelled');
		const kinds = (await db.select().from(activity).where(eq(activity.subjectId, inv.id))).map((a) => a.kind);
		expect(kinds).toContain('invoice.provider_cancel_failed');
	});
});

describe('openInvoice: one purchase, several requests', () => {
	const project = () => ({ id: projectId });

	it('hands back the pending invoice for an identical request', async () => {
		const full = { ...input, returnUrl: 'https://shop.test/done', metadata: { plan: 'pro', user: '7' } };
		const a = await openInvoice(ctx, project(), full);
		expect(a.reused).toBe(false);
		// Metadata is compared as canonical JSON: key order does not matter; expiresIn is not part of it.
		const b = await openInvoice(ctx, project(), { ...full, metadata: { user: '7', plan: 'pro' }, expiresIn: 600 });
		expect(b).toMatchObject({ reused: true, invoice: { id: a.invoice.id } });
		expect(qpay.count('POST /v2/invoice')).toBe(1);
		expect(await db.select().from(invoice)).toHaveLength(1);
	});

	it('null metadata and {} are the same purchase', async () => {
		const a = await openInvoice(ctx, project(), input);
		expect((await openInvoice(ctx, project(), { ...input, metadata: {} })).invoice.id).toBe(a.invoice.id);
		const b = await openInvoice(ctx, project(), { ...input, reference: 'order-2', metadata: {} });
		expect((await openInvoice(ctx, project(), { ...input, reference: 'order-2', metadata: null })).invoice.id).toBe(b.invoice.id);
	});

	it('a shared reference with different contents is a different purchase: never reused', async () => {
		const full = { ...input, returnUrl: 'https://shop.test/done', metadata: { plan: 'pro' } };
		const a = await openInvoice(ctx, project(), full);
		const others = [
			await openInvoice(ctx, project(), { ...full, description: 'Different text' }),
			await openInvoice(ctx, project(), { ...full, returnUrl: 'https://shop.test/other' }),
			await openInvoice(ctx, project(), { ...full, returnUrl: null }),
			await openInvoice(ctx, project(), { ...full, metadata: { plan: 'max' } }),
			await openInvoice(ctx, project(), { ...full, metadata: null })
		];
		for (const o of others) {
			expect(o.reused).toBe(false);
			expect(o.invoice.id).not.toBe(a.invoice.id);
		}
		expect(qpay.count('POST /v2/invoice')).toBe(6);
	});

	it('creates a new invoice for a different amount or provider, or with reuse: false', async () => {
		const a = await openInvoice(ctx, project(), input);
		const other = [
			await openInvoice(ctx, project(), { ...input, amount: 50_000 }),
			await openInvoice(ctx, project(), { ...input, reuse: false }),
			await openInvoice(ctx, project(), { ...input, reference: 'order-2' })
		];
		fakeBonum({
			'POST /bonum-gateway/ecommerce/invoices': () =>
				jsonResponse({ invoiceId: 'bonum-inv-1', followUpLink: 'https://ecommerce.bonum.mn/ecommerce?invoiceId=bonum-inv-1' })
		});
		other.push(await openInvoice(ctx, project(), { ...input, provider: 'bonum' }));
		for (const o of other) {
			expect(o.reused).toBe(false);
			expect(o.invoice.id).not.toBe(a.invoice.id);
		}
	});

	it('never reuses an ended, expiring, failed or other project\'s invoice', async () => {
		const paid = await newInvoice(ctx, project(), input);
		await settleInvoice(ctx, paid, { providerRef: 'p-1', amount: 49_900 });
		const expired = await newInvoice(ctx, project(), { ...input, reference: 'order-2' });
		await endInvoice(ctx, expired, 'expired');
		const soon = await newInvoice(ctx, project(), { ...input, reference: 'order-3', expiresIn: 60 });
		const late = { ...ctx, now: NOW + 60_000 - REUSE_MIN_REMAINING_MS + 1 };
		expect((await openInvoice(late, project(), { ...input, reference: 'order-3' })).invoice.id).not.toBe(soon.id);
		expect((await openInvoice(ctx, project(), input)).reused).toBe(false);
		expect((await openInvoice(ctx, project(), { ...input, reference: 'order-2' })).reused).toBe(false);
		const otherProject = (await seedProject(db)).project.id;
		expect((await openInvoice(ctx, { id: otherProject }, { ...input, reference: 'order-3' })).reused).toBe(false);
		qpay.failures.set('POST /v2/invoice', { status: 500, times: 1 });
		await codeOf(newInvoice(ctx, project(), { ...input, reference: 'order-4' }));
		expect((await openInvoice(ctx, project(), { ...input, reference: 'order-4' })).reused).toBe(false);
	});

	it('refuses a non-boolean reuse', async () => {
		expect(await codeOf(openInvoice(ctx, project(), { ...input, reuse: 'no' as unknown as boolean }))).toBe('400 invalid_request');
	});
});

describe('settleInvoice: the purchase\'s other invoices', () => {
	const project = () => ({ id: projectId });
	const row = async (id: string) => (await db.select().from(invoice).where(eq(invoice.id, id)))[0]!;
	const kindsOf = async (id: string) => (await db.select().from(activity).where(eq(activity.subjectId, id))).map((a) => a.kind);

	it('cancels the other pending invoices of the same purchase, at QPay too, with no event', async () => {
		const a = await newInvoice(ctx, project(), { ...input, metadata: { x: '1', y: '2' }, reuse: false });
		const b = await newInvoice(ctx, project(), { ...input, metadata: { y: '2', x: '1' }, reuse: false });
		const unrelated = await newInvoice(ctx, project(), { ...input, reference: 'order-2' });
		expect(await settleInvoice(ctx, b, { providerRef: 'pay-b', amount: 49_900 })).toBe('settled');
		expect((await row(a.id)).status).toBe('cancelled');
		expect((await row(unrelated.id)).status).toBe('pending');
		expect(qpay.count('DELETE /v2/invoice/:id')).toBe(1);
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.paid']);
		expect(await kindsOf(a.id)).toContain('invoice.superseded');
	});

	it('a shared reference with different contents: not cancelled, and not flagged as paid twice', async () => {
		const paid = await newInvoice(ctx, project(), { ...input, returnUrl: 'https://shop.test/done', metadata: { cart: '1' } });
		const differ = [
			await newInvoice(ctx, project(), { ...input, amount: 10_000 }),
			await newInvoice(ctx, project(), { ...input, description: 'Another item', returnUrl: 'https://shop.test/done', metadata: { cart: '1' } }),
			await newInvoice(ctx, project(), { ...input, returnUrl: 'https://shop.test/other', metadata: { cart: '1' } }),
			await newInvoice(ctx, project(), { ...input, returnUrl: 'https://shop.test/done', metadata: { cart: '2' } }),
			await newInvoice(ctx, project(), { ...input, returnUrl: 'https://shop.test/done' })
		];
		expect(await settleInvoice(ctx, paid, { providerRef: 'pay-1', amount: 49_900 })).toBe('settled');
		for (const d of differ) expect((await row(d.id)).status).toBe('pending');
		expect(qpay.count('DELETE /v2/invoice/:id')).toBe(0);
		// Each is paid in turn: every invoice.paid is plain, nothing is flagged.
		let t = NOW;
		for (const d of differ) {
			t += 1000;
			expect(await settleInvoice({ ...ctx, now: t }, d, { providerRef: `pay-${d.id}`, amount: d.amount })).toBe('settled');
		}
		for (const e of await db.select().from(event)) expect(e.data).not.toHaveProperty('duplicateOfInvoiceId');
		expect(await db.select().from(activity).where(eq(activity.kind, 'invoice.duplicate_payment'))).toHaveLength(0);
	});

	it('runs the cancel in the background when it can, and a failing cancel never fails the settlement', async () => {
		const a = await newInvoice(ctx, project(), { ...input, reuse: false });
		const b = await newInvoice(ctx, project(), { ...input, reuse: false });
		const tasks: Promise<unknown>[] = [];
		qpay.failures.set('DELETE /v2/invoice/:id', { status: 500 });
		const bg = { ...ctx, waitUntil: (t: Promise<unknown>) => void tasks.push(t) };
		expect(await settleInvoice(bg, b, { providerRef: 'pay-b', amount: 49_900 })).toBe('settled');
		expect(tasks).toHaveLength(1);
		await Promise.all(tasks);
		expect((await row(b.id)).status).toBe('paid');
		// QPay did not confirm the cancel: left pending, so the expiry check still asks about it.
		expect((await row(a.id)).status).toBe('pending');
		expect(await kindsOf(a.id)).toContain('invoice.provider_cancel_failed');
		expect(await kindsOf(a.id)).not.toContain('invoice.superseded');
	});

	it('a sibling QPay refuses to cancel stays pending and is settled at its expiry check', async () => {
		const a = await newInvoice(ctx, project(), { ...input, reuse: false });
		const b = await newInvoice(ctx, project(), { ...input, reuse: false });
		qpay.failures.set('DELETE /v2/invoice/:id', { status: 400, body: JSON.stringify({ error: 'INVOICE_PAID' }) });
		expect(await settleInvoice(ctx, b, { providerRef: 'pay-b', amount: 49_900 })).toBe('settled');
		expect((await row(a.id)).status).toBe('pending');
		qpay.pay(a.providerInvoiceId!, 49_900);
		expect(await sweepExpired(db, ctx.config, a.expiresAt)).toBe(1);
		expect((await row(a.id)).status).toBe('paid');
		const paidEvents = (await db.select().from(event).orderBy(event.id)).filter((e) => e.subjectId === a.id);
		expect(paidEvents[0]!.data).toMatchObject({ duplicateOfInvoiceId: b.id });
	});

	it('honours money that reaches a cancelled sibling, flagged as paid twice', async () => {
		const a = await newInvoice(ctx, project(), { ...input, reuse: false });
		const b = await newInvoice(ctx, project(), { ...input, reuse: false });
		await settleInvoice(ctx, a, { providerRef: 'pay-a', amount: 49_900 });
		expect((await row(b.id)).status).toBe('cancelled');
		expect(await settleInvoice({ ...ctx, now: NOW + 1000 }, await row(b.id), { providerRef: 'pay-b', amount: 49_900 })).toBe('settled');
		expect((await row(b.id)).status).toBe('paid');
		const events = await db.select().from(event).orderBy(event.id);
		expect(events.map((e) => [e.type, e.subjectId])).toEqual([
			['invoice.paid', a.id],
			['invoice.paid', b.id]
		]);
		expect(events[0]!.data).not.toHaveProperty('duplicateOfInvoiceId');
		expect(events[1]!.data).toMatchObject({ duplicateOfInvoiceId: a.id });
		expect(await kindsOf(b.id)).toContain('invoice.duplicate_payment');
		expect(await kindsOf(a.id)).not.toContain('invoice.duplicate_payment');
	});

	it('records the duplicate even when two settle at the same time', async () => {
		const a = await newInvoice(ctx, project(), { ...input, reuse: false });
		const b = await newInvoice(ctx, project(), { ...input, reuse: false });
		await Promise.all([
			settleInvoice(ctx, a, { providerRef: 'pay-a', amount: 49_900 }),
			settleInvoice(ctx, b, { providerRef: 'pay-b', amount: 49_900 })
		]);
		const flagged = (await db.select().from(activity).where(eq(activity.kind, 'invoice.duplicate_payment'))).length;
		expect(flagged).toBeGreaterThanOrEqual(1);
		expect(await db.select().from(ledger)).toHaveLength(2);
	});
});
