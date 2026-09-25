import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../ids';
import { activity, invoice, type Invoice } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createTestDb, seedProject, testConfig, type TestDb } from '../../testdb';
import { resetQpayTokenCache } from './client';
import { fakeQpay, type FakeQpay } from './fake';
import { MAX_QR_IMAGE_CHARS, qpayInvoiceAdapter } from './invoice';

let db: TestDb;
let ctx: ServiceContext;
let qpay: FakeQpay;
let projectId: string;

async function row(overrides: Partial<typeof invoice.$inferInsert> = {}): Promise<Invoice> {
	const id = newId();
	await db.insert(invoice).values({
		id,
		projectId,
		provider: 'qpay',
		amount: 49_900,
		reference: 'order-1',
		description: 'Pro plan',
		expiresAt: 10_000,
		createdAt: 1_000,
		updatedAt: 1_000,
		...overrides
	});
	const [r] = await db.select().from(invoice).where(eq(invoice.id, id));
	return r!;
}

beforeEach(async () => {
	resetQpayTokenCache();
	db = createTestDb();
	projectId = (await seedProject(db)).project.id;
	ctx = { db, config: testConfig(), now: 5_000 };
	qpay = fakeQpay();
	vi.stubGlobal('fetch', qpay.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('qpayInvoiceAdapter.create', () => {
	it('sends our id, the callback URL, the amount and description', async () => {
		const inv = await row();
		const out = await qpayInvoiceAdapter.create(ctx, inv);
		expect(qpay.created[0]).toMatchObject({
			invoice_code: 'TEST_INVOICE',
			sender_invoice_no: inv.id,
			invoice_receiver_code: 'terminal',
			invoice_description: 'Pro plan',
			amount: 49_900,
			callback_url: `https://payments.test/hooks/qpay/${inv.id}`
		});
		expect(out.providerInvoiceId).toBe(`qp-${inv.id}`);
		expect(out.qrText).toBe(`QRTEXT-qp-${inv.id}`);
		expect(out.qrImage).toBe('iVBORw0KGgoAAAANSUhEUg==');
		// The javascript: link is dropped; logos must be https.
		expect(out.deeplinks).toEqual([
			{ name: 'Khan bank', description: 'Хаан банк', logo: 'https://s3.qpay.mn/khan.png', link: `khanbank://q?qPay_QRcode=qp-${inv.id}` }
		]);
	});

	it('drops an oversized QR image', async () => {
		qpay.fetch.mockImplementationOnce(async () =>
			new Response(JSON.stringify({ access_token: 'at-x', refresh_token: 'rt-x', expires_in: Math.floor(Date.now() / 1000) + 3600, refresh_expires_in: Math.floor(Date.now() / 1000) + 7200 }))
		);
		qpay.fetch.mockImplementationOnce(async () =>
			new Response(JSON.stringify({ invoice_id: 'big', qr_text: 'q', qr_image: 'A'.repeat(MAX_QR_IMAGE_CHARS + 4), urls: [] }))
		);
		const out = await qpayInvoiceAdapter.create(ctx, await row());
		expect(out).toMatchObject({ providerInvoiceId: 'big', qrImage: null, deeplinks: [] });
	});

	it('fails without an invoice id in the answer', async () => {
		qpay.fetch.mockImplementationOnce(async () =>
			new Response(JSON.stringify({ access_token: 'at-x', refresh_token: 'rt-x', expires_in: Math.floor(Date.now() / 1000) + 3600, refresh_expires_in: 0 }))
		);
		qpay.fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ qr_text: 'q' })));
		await expect(qpayInvoiceAdapter.create(ctx, await row())).rejects.toMatchObject({ code: 'bad_response' });
	});
});

describe('qpayInvoiceAdapter.check', () => {
	it('is unpaid with no rows', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1' });
		expect(await qpayInvoiceAdapter.check!(ctx, inv)).toEqual({ paid: false });
		expect(qpay.created).toHaveLength(0);
	});

	it('is paid by a PAID row of the exact amount, with QPay payment_id as providerRef', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1' });
		qpay.pay('qp-1', 49_900, 'FAILED');
		const paymentId = qpay.pay('qp-1', 49_900);
		expect(await qpayInvoiceAdapter.check!(ctx, inv)).toEqual({ paid: true, providerRef: paymentId, amount: 49_900, paidAt: 5_000 });
	});

	it('ignores non-PAID rows', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1' });
		qpay.pay('qp-1', 49_900, 'NEW');
		qpay.pay('qp-1', 49_900, 'REFUNDED');
		expect(await qpayInvoiceAdapter.check!(ctx, inv)).toEqual({ paid: false });
	});

	it('does not settle a different amount, and records it', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1' });
		qpay.pay('qp-1', 100);
		expect(await qpayInvoiceAdapter.check!(ctx, inv)).toEqual({ paid: false });
		const [a] = await db.select().from(activity);
		expect(a).toMatchObject({ kind: 'qpay.payment.amount_mismatch', subjectId: inv.id });
	});

	it('does not call QPay for an invoice it never minted', async () => {
		expect(await qpayInvoiceAdapter.check!(ctx, await row())).toEqual({ paid: false });
		expect(qpay.calls).toHaveLength(0);
	});
});

describe('qpayInvoiceAdapter.check: refunds and notes', () => {
	const kinds = async () => (await db.select().from(activity)).map((a) => a.kind);

	it('records qpay.payment_refunded only when QPay returns the settled row with another status', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1', status: 'paid', providerTransactionId: 'pay-1', paidAt: 2_000 });
		qpay.pay('qp-1', 49_900, 'REFUNDED');
		expect(await qpayInvoiceAdapter.check!(ctx, inv)).toEqual({ paid: false });
		const [a] = await db.select().from(activity);
		expect(a).toMatchObject({ kind: 'qpay.payment_refunded' });
		expect(a!.summary).toContain('pay-1 as REFUNDED');
	});

	it('records nothing for an empty answer or a missing row', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1', status: 'paid', providerTransactionId: 'pay-1', paidAt: 2_000 });
		expect(await qpayInvoiceAdapter.check!(ctx, inv)).toEqual({ paid: false });
		// QPay answers with rows, but not the settled one.
		const other = await row({ providerInvoiceId: 'qp-2', status: 'paid', providerTransactionId: 'pay-99', paidAt: 2_000 });
		qpay.pay('qp-2', 49_900, 'NEW');
		expect(await qpayInvoiceAdapter.check!(ctx, other)).toEqual({ paid: false });
		expect(await kinds()).toEqual([]);
	});

	it('a failing note write never makes check throw or change its answer', async () => {
		const inv = await row({ providerInvoiceId: 'qp-1' });
		const first = qpay.pay('qp-1', 49_900);
		qpay.pay('qp-1', 49_900); // a second PAID row: qpay.extra_payment would be written
		const broken = { ...ctx, db: failingActivity(db) };
		expect(await qpayInvoiceAdapter.check!(broken, inv)).toEqual({ paid: true, providerRef: first, amount: 49_900, paidAt: 5_000 });
		// A mismatched amount and a refund are notes too.
		const mismatch = await row({ providerInvoiceId: 'qp-2' });
		qpay.pay('qp-2', 100);
		expect(await qpayInvoiceAdapter.check!(broken, mismatch)).toEqual({ paid: false });
		const paid = await row({ providerInvoiceId: 'qp-3', status: 'paid', providerTransactionId: 'refunded', paidAt: 2_000 });
		qpay.payments.set('qp-3', [{ payment_id: 'refunded', payment_status: 'REFUNDED', payment_amount: '49900.00' }]);
		expect(await qpayInvoiceAdapter.check!(broken, paid)).toEqual({ paid: false });
		expect(await kinds()).toEqual([]);
	});
});

/** The test DB, except that every read or write of `activity` fails (as D1 might). */
function failingActivity(real: TestDb): TestDb {
	const fail = () => {
		throw new Error('d1 down');
	};
	return new Proxy(real, {
		get(target, prop) {
			if (prop === 'insert') return (table: unknown) => (table === activity ? fail() : target.insert(table as typeof invoice));
			if (prop === 'select') {
				return (...args: unknown[]) => {
					const builder = (target.select as (...a: unknown[]) => { from: (t: unknown) => unknown })(...args);
					return { from: (t: unknown) => (t === activity ? fail() : builder.from(t)) };
				};
			}
			const value = Reflect.get(target, prop);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

describe('qpayInvoiceAdapter.cancel', () => {
	it('deletes the QPay invoice', async () => {
		await qpayInvoiceAdapter.cancel!(ctx, await row({ providerInvoiceId: 'qp-1' }));
		expect(qpay.count('DELETE /v2/invoice/:id')).toBe(1);
	});

	it('treats already-cancelled as done, other errors as errors', async () => {
		qpay.failures.set('DELETE /v2/invoice/:id', {
			status: 400,
			body: JSON.stringify({ error: 'INVOICE_ALREADY_CANCELED' }),
			times: 1
		});
		await expect(qpayInvoiceAdapter.cancel!(ctx, await row({ providerInvoiceId: 'qp-1' }))).resolves.toBeUndefined();
		qpay.failures.set('DELETE /v2/invoice/:id', { status: 500 });
		await expect(qpayInvoiceAdapter.cancel!(ctx, await row({ providerInvoiceId: 'qp-2' }))).rejects.toMatchObject({ status: 500 });
	});
});
