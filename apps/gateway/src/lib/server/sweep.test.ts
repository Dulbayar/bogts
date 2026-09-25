import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from './ids';
import { resetQpayTokenCache } from './providers/qpay/client';
import { fakeQpay, type FakeQpay } from './providers/qpay/fake';
import { activity, event, invoice, ledger, type Provider } from './schema';
import {
	BONUM_EXPIRY_GRACE_MS,
	LATE_CHECK_AFTER_MS,
	LATE_CHECK_BATCH,
	LATE_CHECK_MAX_AGE_MS,
	lateCheckExpired,
	STALE_CLAIM_MS,
	SWEEP_BATCH,
	sweepExpired
} from './sweep';
import { settleInvoice } from './services/settle';
import { createTestDb, seedProject, testConfig, type TestDb } from './testdb';

let db: TestDb;
let qpay: FakeQpay;
let projectId: string;
const config = testConfig();

const NOW = Date.UTC(2026, 8, 25, 12, 10, 0);

async function seed(opts: { provider?: Provider; expiresAt?: number; providerInvoiceId?: string | null; sweptAt?: number | null } = {}) {
	const id = newId();
	await db.insert(invoice).values({
		id,
		projectId,
		provider: opts.provider ?? 'qpay',
		amount: 49_900,
		reference: 'order-1',
		description: 'Pro',
		providerInvoiceId: opts.providerInvoiceId === undefined ? `qp-${id}` : opts.providerInvoiceId,
		expiresAt: opts.expiresAt ?? NOW - 60_000,
		sweptAt: opts.sweptAt ?? null,
		createdAt: NOW - 3_600_000,
		updatedAt: NOW - 3_600_000
	});
	return id;
}

async function row(id: string) {
	const [r] = await db.select().from(invoice).where(eq(invoice.id, id));
	return r!;
}
const eventTypes = async () => (await db.select().from(event)).map((e) => e.type);
const checks = () => qpay.count('POST /v2/payment/check');

beforeEach(async () => {
	resetQpayTokenCache();
	db = createTestDb();
	projectId = (await seedProject(db)).project.id;
	qpay = fakeQpay();
	vi.stubGlobal('fetch', qpay.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('sweepExpired', () => {
	it('settles an invoice found paid at the check', async () => {
		const id = await seed();
		const paymentId = qpay.pay(`qp-${id}`, 49_900);
		expect(await sweepExpired(db, config, NOW)).toBe(1);
		expect(await row(id)).toMatchObject({ status: 'paid', providerTransactionId: paymentId, sweptAt: NOW });
		expect(await eventTypes()).toEqual(['invoice.paid']);
	});

	it('expires an unpaid invoice', async () => {
		const id = await seed();
		expect(await sweepExpired(db, config, NOW)).toBe(1);
		expect(await row(id)).toMatchObject({ status: 'expired', sweptAt: NOW });
		expect(await eventTypes()).toEqual(['invoice.expired']);
		expect(checks()).toBe(1);
	});

	it('expires and marks swept when QPay is down, and records it', async () => {
		const id = await seed();
		qpay.failures.set('POST /v2/payment/check', { status: 502 });
		expect(await sweepExpired(db, config, NOW)).toBe(1);
		expect(await row(id)).toMatchObject({ status: 'expired', sweptAt: NOW });
		const kinds = (await db.select().from(activity)).map((a) => a.kind);
		expect(kinds).toContain('sweep.check_failed');
		// Checked once: a later run does not ask again.
		qpay.failures.clear();
		await sweepExpired(db, config, NOW + 600_000);
		expect(checks()).toBe(1);
	});

	it('never checks an invoice twice', async () => {
		await seed();
		await sweepExpired(db, config, NOW);
		await sweepExpired(db, config, NOW + 600_000);
		await sweepExpired(db, config, NOW + 1_200_000);
		expect(checks()).toBe(1);
		expect(await eventTypes()).toEqual(['invoice.expired']);
	});

	it('two concurrent runs do not double-check', async () => {
		for (let i = 0; i < 5; i++) await seed();
		const counts = await Promise.all([sweepExpired(db, config, NOW), sweepExpired(db, config, NOW)]);
		expect(counts[0] + counts[1]).toBe(5);
		expect(checks()).toBe(5);
		expect((await eventTypes()).filter((t) => t === 'invoice.expired')).toHaveLength(5);
	});

	it('leaves invoices that have not expired yet, and ended ones', async () => {
		const future = await seed({ expiresAt: NOW + 1 });
		const paid = await seed();
		await db.update(invoice).set({ status: 'paid' }).where(eq(invoice.id, paid));
		expect(await sweepExpired(db, config, NOW)).toBe(0);
		expect((await row(future)).status).toBe('pending');
		expect(checks()).toBe(0);
	});

	it('expires a Bonum invoice locally, without a check, only after the grace period', async () => {
		const expiresAt = NOW - 60_000;
		const id = await seed({ provider: 'bonum', providerInvoiceId: 'bonum-1', expiresAt });
		// Within the grace: Bonum may still be retrying its PAYMENT webhook.
		expect(await sweepExpired(db, config, NOW)).toBe(0);
		expect(await sweepExpired(db, config, expiresAt + BONUM_EXPIRY_GRACE_MS - 1)).toBe(0);
		expect((await row(id)).status).toBe('pending');
		expect(await sweepExpired(db, config, expiresAt + BONUM_EXPIRY_GRACE_MS)).toBe(1);
		expect((await row(id)).status).toBe('expired');
		expect(qpay.calls).toHaveLength(0);
	});

	it('a Bonum PAYMENT webhook within the grace settles the pending invoice, and after it still settles', async () => {
		const { handleBonumWebhook } = await import('./providers/bonum/webhook');
		const payment = (id: string, bonumId: string) => ({
			type: 'PAYMENT',
			status: 'SUCCESS',
			message: '',
			body: { amount: 49900.0, currency: 'MNT', completedAt: '2026-09-25 20:05:00', invoiceId: bonumId, transactionId: id, status: 'PAID' }
		});
		const inGrace = await seed({ provider: 'bonum', providerInvoiceId: 'bonum-1' });
		await sweepExpired(db, config, NOW);
		expect(await handleBonumWebhook({ db, config, now: NOW + 60_000 }, payment(inGrace, 'bonum-1'))).toBe('processed');
		expect((await row(inGrace)).status).toBe('paid');

		const late = await seed({ provider: 'bonum', providerInvoiceId: 'bonum-2' });
		await sweepExpired(db, config, NOW + BONUM_EXPIRY_GRACE_MS);
		expect((await row(late)).status).toBe('expired');
		expect(await handleBonumWebhook({ db, config, now: NOW + BONUM_EXPIRY_GRACE_MS + 1 }, payment(late, 'bonum-2'))).toBe('processed');
		expect((await row(late)).status).toBe('paid');
		const types = (await db.select().from(event)).filter((e) => e.subjectId === late).map((e) => e.type);
		expect(types).toEqual(['invoice.expired', 'invoice.paid']);
	});

	it('takes at most 100 per run, oldest first', async () => {
		const oldest = await seed({ expiresAt: NOW - 10 * 60_000 });
		for (let i = 0; i < SWEEP_BATCH; i++) await seed({ expiresAt: NOW - 60_000 });
		expect(await sweepExpired(db, config, NOW)).toBe(SWEEP_BATCH);
		expect((await row(oldest)).status).toBe('expired');
		expect(await sweepExpired(db, config, NOW)).toBe(1);
	});

	it('honours a late payment after the sweep expired it', async () => {
		const { settleInvoice } = await import('./services/settle');
		const id = await seed();
		await sweepExpired(db, config, NOW);
		const late = await settleInvoice({ db, config, now: NOW + 1 }, await row(id), { providerRef: 'late-1', amount: 49_900 });
		expect(late).toBe('settled');
		expect(await eventTypes()).toEqual(['invoice.expired', 'invoice.paid']);
		expect(await db.select().from(ledger)).toHaveLength(1);
	});

	it('expires a claim whose run died, without checking again', async () => {
		const id = await seed({ sweptAt: NOW - STALE_CLAIM_MS });
		expect(await sweepExpired(db, config, NOW)).toBe(0);
		expect((await row(id)).status).toBe('expired');
		expect(checks()).toBe(0);
	});

	it('never rejects', async () => {
		const broken = { select: () => { throw new Error('d1 down'); } } as unknown as TestDb;
		await expect(sweepExpired(broken, config, NOW)).resolves.toBe(0);
	});
});

describe('lateCheckExpired', () => {
	const EXPIRED_AT = NOW - 60_000;
	const DUE = EXPIRED_AT + LATE_CHECK_AFTER_MS;

	async function expired(opts: { expiresAt?: number; provider?: Provider } = {}) {
		const id = await seed({ expiresAt: opts.expiresAt ?? EXPIRED_AT, provider: opts.provider });
		await db.update(invoice).set({ status: 'expired', sweptAt: NOW }).where(eq(invoice.id, id));
		return id;
	}

	it('settles an expired invoice paid while its callback was lost, about 24 h on', async () => {
		const id = await seed({ expiresAt: EXPIRED_AT });
		await sweepExpired(db, config, NOW);
		expect((await row(id)).status).toBe('expired');
		const paymentId = qpay.pay(`qp-${id}`, 49_900);
		// Not yet due.
		expect(await lateCheckExpired(db, config, DUE - 1)).toBe(0);
		expect(await lateCheckExpired(db, config, DUE)).toBe(1);
		expect(await row(id)).toMatchObject({ status: 'paid', providerTransactionId: paymentId, lateCheckedAt: DUE });
		expect(await eventTypes()).toEqual(['invoice.expired', 'invoice.paid']);
		expect((await db.select().from(activity)).map((a) => a.kind)).toContain('late_check.paid');
	});

	it('checks each invoice at most once, and nothing else', async () => {
		const id = await expired();
		const paid = await seed({ expiresAt: EXPIRED_AT });
		await db.update(invoice).set({ status: 'paid' }).where(eq(invoice.id, paid));
		const cancelled = await seed({ expiresAt: EXPIRED_AT });
		await db.update(invoice).set({ status: 'cancelled' }).where(eq(invoice.id, cancelled));
		await expired({ provider: 'bonum' });
		await expired({ expiresAt: DUE - LATE_CHECK_MAX_AGE_MS }); // too old
		// The expired and the cancelled QPay invoices; not the paid, Bonum or too old ones.
		expect(await lateCheckExpired(db, config, DUE)).toBe(2);
		expect(await lateCheckExpired(db, config, DUE + 600_000)).toBe(0);
		expect(checks()).toBe(2);
		expect(await row(id)).toMatchObject({ status: 'expired', lateCheckedAt: DUE });
		expect(await row(cancelled)).toMatchObject({ status: 'cancelled', lateCheckedAt: DUE });
		expect((await row(paid)).lateCheckedAt).toBeNull();
		expect(await eventTypes()).toEqual([]);
	});

	it('settles a project-cancelled QPay invoice paid anyway, once', async () => {
		const id = await seed({ expiresAt: EXPIRED_AT });
		await db.update(invoice).set({ status: 'cancelled' }).where(eq(invoice.id, id));
		const paymentId = qpay.pay(`qp-${id}`, 49_900);
		expect(await lateCheckExpired(db, config, DUE - 1)).toBe(0);
		expect(await lateCheckExpired(db, config, DUE)).toBe(1);
		expect(await row(id)).toMatchObject({ status: 'paid', providerTransactionId: paymentId, lateCheckedAt: DUE });
		expect(await eventTypes()).toEqual(['invoice.paid']);
		expect(await lateCheckExpired(db, config, DUE + 600_000)).toBe(0);
		expect(checks()).toBe(1);
	});

	it('settles a sibling-cancelled QPay invoice paid anyway, flagged as paid twice', async () => {
		const first = await seed({ expiresAt: EXPIRED_AT });
		const sibling = await seed({ expiresAt: EXPIRED_AT });
		const ctx = { db, config, now: EXPIRED_AT - 600_000 };
		expect(await settleInvoice(ctx, await row(first), { providerRef: 'pay-first', amount: 49_900 })).toBe('settled');
		expect((await row(sibling)).status).toBe('cancelled');
		qpay.pay(`qp-${sibling}`, 49_900);
		expect(await lateCheckExpired(db, config, DUE)).toBe(1);
		expect((await row(sibling)).status).toBe('paid');
		const [, late] = await db.select().from(event).orderBy(event.id);
		expect(late).toMatchObject({ type: 'invoice.paid', subjectId: sibling, data: { duplicateOfInvoiceId: first } });
	});

	it('a QPay error still uses up the one late check', async () => {
		const id = await expired();
		qpay.failures.set('POST /v2/payment/check', { status: 502 });
		expect(await lateCheckExpired(db, config, DUE)).toBe(1);
		qpay.failures.clear();
		expect(await lateCheckExpired(db, config, DUE + 600_000)).toBe(0);
		expect(checks()).toBe(1);
		expect((await db.select().from(activity)).map((a) => a.kind)).toContain('late_check.failed');
		expect((await row(id)).status).toBe('expired');
	});

	it('two concurrent runs claim each invoice once, at most 100 per run', async () => {
		for (let i = 0; i < LATE_CHECK_BATCH + 5; i++) await expired();
		const counts = await Promise.all([lateCheckExpired(db, config, DUE), lateCheckExpired(db, config, DUE)]);
		expect(counts[0] + counts[1]).toBeLessThanOrEqual(2 * LATE_CHECK_BATCH);
		expect(checks()).toBe(counts[0] + counts[1]);
		const more = await lateCheckExpired(db, config, DUE + 600_000);
		expect(counts[0] + counts[1] + more).toBe(LATE_CHECK_BATCH + 5);
		expect(checks()).toBe(LATE_CHECK_BATCH + 5);
	});

	it('does nothing when QPay is off, and never rejects', async () => {
		await expired();
		expect(await lateCheckExpired(db, testConfig({ qpay: null, providers: { bonum: true, qpay: false } }), DUE)).toBe(0);
		const broken = { select: () => { throw new Error('d1 down'); } } as unknown as TestDb;
		await expect(lateCheckExpired(broken, config, DUE)).resolves.toBe(0);
	});
});
