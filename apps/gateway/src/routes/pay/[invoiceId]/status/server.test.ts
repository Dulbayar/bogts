import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetQpayTokenCache } from '$lib/server/providers/qpay/client';
import { fakeQpay, type FakeQpay } from '$lib/server/providers/qpay/fake';
import { activity, event, invoice, rateLimit } from '$lib/server/schema';
import { openInvoice } from '$lib/server/services/invoices';
import { createTestDb, seedProject, testConfig, type TestDb } from '$lib/server/testdb';
import { STATUS_LIMIT } from '$lib/server/public/invoice-view';
import { GET } from './+server';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const CHECK = 'POST /v2/payment/check';

let db: TestDb;
let qpay: FakeQpay;
let projectId: string;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	resetQpayTokenCache();
	db = createTestDb();
	projectId = (await seedProject(db)).project.id;
	qpay = fakeQpay();
	vi.stubGlobal('fetch', qpay.fetch);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const newInvoice = async () =>
	(await openInvoice({ db, config: testConfig(), now: NOW }, { id: projectId }, { provider: 'qpay', amount: 49_900, reference: 'order-1', description: 'Pro' })).invoice;

async function poll(invoiceId: string, ip = '203.0.113.7') {
	const url = new URL(`https://payments.test/pay/${invoiceId}/status`);
	const locals = { db, config: testConfig(), waitUntil: () => {} };
	const e = { url, request: new Request(url), params: { invoiceId }, locals, getClientAddress: () => ip };
	const res = await GET(e as unknown as RequestEvent<{ invoiceId: string }> as never);
	return { status: res.status, body: (await res.json()) as { status: string; paidAt: string | null; returnUrl: string | null } };
}

describe('GET /pay/:id/status', () => {
	it('asks QPay at most once per 10 s per invoice while pending', async () => {
		const inv = await newInvoice();
		expect((await poll(inv.id)).body.status).toBe('pending');
		expect(qpay.count(CHECK)).toBe(1);
		// Another poll (even from another address) inside the window does not ask.
		expect((await poll(inv.id, '198.51.100.1')).body.status).toBe('pending');
		expect(qpay.count(CHECK)).toBe(1);
		vi.setSystemTime(NOW + 10_001);
		await poll(inv.id);
		expect(qpay.count(CHECK)).toBe(2);
	});

	it('settles a payment QPay confirms, the same way as the callback', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 49_900);
		const { body } = await poll(inv.id);
		expect(body).toMatchObject({ status: 'paid', paidAt: new Date(NOW).toISOString() });
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.paid']);
		expect((await db.select().from(activity)).map((a) => a.kind)).toContain('qpay.poll.paid');
		// Paid: no more checks.
		vi.setSystemTime(NOW + 60_000);
		await poll(inv.id);
		expect(qpay.count(CHECK)).toBe(1);
	});

	it('answers pending when QPay errors', async () => {
		const inv = await newInvoice();
		qpay.pay(inv.providerInvoiceId!, 49_900);
		qpay.failures.set(CHECK, { status: 500 });
		const res = await poll(inv.id);
		expect(res).toMatchObject({ status: 200, body: { status: 'pending' } });
		expect((await db.select().from(invoice).where(eq(invoice.id, inv.id)))[0]!.status).toBe('pending');
	});

	it('does not ask about an expired invoice', async () => {
		const inv = await newInvoice();
		vi.setSystemTime(NOW + 1800 * 1000 + 1);
		await poll(inv.id);
		expect(qpay.count(CHECK)).toBe(0);
	});

	it('limits per IPv6 /64 at 240 a minute', async () => {
		expect(STATUS_LIMIT).toBe(240);
		const inv = await newInvoice();
		await db.insert(rateLimit).values({ key: 'pay-status:2001:db8:1:2::/64', count: STATUS_LIMIT - 1, windowStart: NOW });
		expect((await poll(inv.id, '2001:db8:1:2::a')).status).toBe(200);
		expect((await poll(inv.id, '2001:db8:1:2:ffff::b')).status).toBe(429);
		expect((await poll(inv.id, '2001:db8:1:3::a')).status).toBe(200);
		vi.setSystemTime(NOW + 60_001);
		expect((await poll(inv.id, '2001:db8:1:2::a')).status).toBe(200);
	});

	it('answers only a safe return URL', async () => {
		const inv = await newInvoice();
		await db.update(invoice).set({ returnUrl: 'javascript:alert(1)' }).where(eq(invoice.id, inv.id));
		expect((await poll(inv.id)).body.returnUrl).toBeNull();
		await db.update(invoice).set({ returnUrl: 'https://shop.mn/done' }).where(eq(invoice.id, inv.id));
		expect((await poll(inv.id)).body.returnUrl).toBe('https://shop.mn/done');
	});
});
