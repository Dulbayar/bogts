import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from './crypto';
import { newId } from './ids';
import { resetBonumTokenCache } from './providers/bonum/client';
import { docJson, SUBSCRIPTION_PAYMENT, withField } from './providers/bonum/fixtures';
import { fakeBonum, jsonResponse } from './providers/bonum/testing';
import { bonumTime } from './providers/bonum/util';
import { handleBonumWebhook } from './providers/bonum/webhook';
import {
	NOTE_EVERY_MS,
	RECONCILE_BATCH,
	RECONCILE_HOLD_MS,
	RECONCILE_RECLAIM_MS,
	reconcileOne,
	reconcileRenewals,
	RENEWAL_OVERDUE_MS
} from './reconcile';
import { activity, card, event, ledger, subscription as subTable, type Plan, type Subscription } from './schema';
import type { ServiceContext } from './services/context';
import { createTestDb, seedPlan, seedProject, TEST_ENCRYPTION_KEY, testConfig, type TestDb } from './testdb';

const at = (s: string) => bonumTime(s)!;
const LIST = 'GET /mpay-service/merchant/subscriptions';
const config = testConfig();

/*
 * Bonum's sample mandate: subscription 41 on plan 4 (3 MNT, monthly), first
 * billing date 2026-01-27 00:00 (UB). The renewal due then was charged at
 * 02:00:08 (the SUBSCRIPTION-PAYMENT sample, invoice 786), but its webhook
 * never arrived.
 */
const DUE = at('2026-01-27 00:00:00');
const CHARGED = '2026-01-27 02:00:08';
const NOW = DUE + RENEWAL_OVERDUE_MS + 60 * 60 * 1000; // 07:00 UB

let db: TestDb;
let projectId: string;
let plan: Plan;

beforeEach(async () => {
	db = createTestDb();
	resetBonumTokenCache();
	projectId = (await seedProject(db)).project.id;
	plan = await seedPlan(db, projectId, { key: 'basic-monthly', providerPlanId: 4, amount: 3, interval: 'monthly' });
});
afterEach(() => vi.unstubAllGlobals());

async function seedMandate(over: Partial<Subscription> = {}, providerId = '41'): Promise<Subscription> {
	const cardId = newId();
	await db.insert(card).values({
		id: cardId,
		projectId,
		customerRef: 'customer-1',
		tokenEnc: await encrypt(`card-token-${providerId}`, TEST_ENCRYPTION_KEY),
		mask: '9496 43** **** 2727',
		createdAt: at('2026-01-26 09:59:11'),
		updatedAt: at('2026-01-26 09:59:11')
	});
	const id = newId();
	const [row] = await db
		.insert(subTable)
		.values({
			id,
			projectId,
			planId: plan.id,
			customerRef: 'customer-1',
			status: 'active',
			providerSubscriptionId: providerId,
			tokenizeTransactionId: providerId === '41' ? '20000007' : newId(),
			cardId,
			currentPeriodStart: at('2026-01-26 09:59:11'),
			currentPeriodEnd: DUE,
			nextBillAt: DUE,
			billingAnchor: DUE,
			createdAt: at('2026-01-26 09:59:00'),
			updatedAt: at('2026-01-26 09:59:11'),
			...over
		})
		.returning();
	// The first charge, credited at activation.
	await db.insert(ledger).values({
		id: newId(),
		projectId,
		provider: 'bonum',
		providerRef: `card-token:${row!.tokenizeTransactionId}`,
		kind: 'subscription',
		subjectId: id,
		amount: 3,
		createdAt: at('2026-01-26 09:59:12')
	});
	return row!;
}

/** Bonum's Get Subscriptions answer (the item has Subscribe's documented shape). */
function remote(over: Record<string, unknown> = {}) {
	return {
		subscriptionId: 41,
		subscribedAt: '2026-01-26 09:59:11',
		cardMask: '9496 43** **** 2727',
		plan: { planId: 4, name: 'Monthly', recurringType: 'MONTHLY', amount: 3, status: 'ACTIVE' },
		nextBillAt: '2026-02-27 00:00:00',
		lastBilledAt: CHARGED,
		status: 'ACTIVE',
		...over
	};
}
const listing = (...items: Record<string, unknown>[]) => () => jsonResponse({ traceId: 't', message: '', data: items, status: 200 });

const ctxAt = (now: number): ServiceContext => ({ db, config, now });
const subRow = async (id: string) => (await db.select().from(subTable).where(eq(subTable.id, id)))[0]!;
const eventsOf = async (id: string) => (await db.select().from(event).where(eq(event.subjectId, id)).orderBy(event.id));
const kinds = async (id: string) => (await db.select().from(activity).where(eq(activity.subjectId, id))).map((a) => a.kind);
const renewals = async (id: string) => (await db.select().from(ledger).where(eq(ledger.subjectId, id))).filter((l) => !l.providerRef.startsWith('card-token:'));
const webhook = (now: number, text: string) => handleBonumWebhook(ctxAt(now), JSON.parse(docJson(text)));
const renewal786 = () => SUBSCRIPTION_PAYMENT;

describe('reconcileRenewals: billed at Bonum, webhook lost', () => {
	it('credits the renewal from lastBilledAt, asking with the card token', async () => {
		const sub = await seedMandate();
		const bonum = fakeBonum({ [LIST]: listing(remote()) });
		expect(await reconcileRenewals(db, config, NOW)).toBe(1);
		expect(bonum.to(LIST)[0]!.headers.get('x-card-token')).toBe('card-token-41');

		expect(await subRow(sub.id)).toMatchObject({
			status: 'active',
			currentPeriodStart: DUE,
			currentPeriodEnd: at('2026-02-27 00:00:00'),
			nextBillAt: at('2026-02-27 00:00:00'),
			reconciledAt: NOW
		});
		expect(await renewals(sub.id)).toMatchObject([
			{ providerRef: `sub-period:${sub.id}:${new Date(DUE).toISOString()}`, periodKey: new Date(DUE).toISOString(), amount: 3 }
		]);
		const [renewed] = await eventsOf(sub.id);
		expect(renewed).toMatchObject({ type: 'subscription.renewed' });
		expect(renewed!.data).toMatchObject({ amount: 3, period: { start: DUE, end: at('2026-02-27 00:00:00') }, nextBillAt: at('2026-02-27 00:00:00') });
		expect(await kinds(sub.id)).toContain('reconcile.renewal_credited');
	});

	it('reconcile first, then the late webhook: credited once, the webhook adopts the row', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote()) });
		await reconcileRenewals(db, config, NOW);
		// The real SUBSCRIPTION-PAYMENT for the same charge (invoice 786) finally lands.
		expect(await webhook(NOW + 60_000, renewal786())).toBe('duplicate');
		expect(await webhook(NOW + 120_000, renewal786())).toBe('duplicate'); // and its replay
		const rows = await renewals(sub.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ providerRef: 'sub-invoice:786', periodKey: new Date(DUE).toISOString(), amount: 3 });
		expect((await eventsOf(sub.id)).map((e) => e.type)).toEqual(['subscription.renewed']);
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-02-27 00:00:00'));
		expect(await kinds(sub.id)).toContain('bonum.subscription_payment.reconciled_earlier');
		// The next month's renewal webhook is still credited normally.
		expect(await webhook(at('2026-02-27 02:00:10'), withField(withField(renewal786(), 'invoiceId', '787'), 'completedAt', '"2026-02-27 02:00:05"'))).toBe('processed');
		expect(await renewals(sub.id)).toHaveLength(2);
	});

	it('webhook first, then reconcile: nothing is credited twice', async () => {
		const sub = await seedMandate();
		const stale = await subRow(sub.id);
		expect(await webhook(at('2026-01-27 02:00:10'), renewal786())).toBe('processed');
		const bonum = fakeBonum({ [LIST]: listing(remote()) });
		// The subscription moved on, so it is not overdue any more.
		expect(await reconcileRenewals(db, config, NOW)).toBe(0);
		expect(bonum.count(LIST)).toBe(0);
		// Even a run that loaded the row before the webhook landed cannot credit it again.
		await reconcileOne(ctxAt(NOW), stale);
		expect(bonum.count(LIST)).toBe(1);
		expect(await renewals(sub.id)).toMatchObject([{ providerRef: 'sub-invoice:786' }]);
		expect((await eventsOf(sub.id)).map((e) => e.type)).toEqual(['subscription.renewed']);
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-02-27 00:00:00'));
	});

	it('the unique period guard holds even if both write at once', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote()) });
		const results = await Promise.allSettled([reconcileRenewals(db, config, NOW), webhook(NOW, renewal786())]);
		// The webhook either adopted the row, credited first, or asks Bonum to retry (503).
		const retried = results[1].status === 'rejected';
		if (retried) expect(await webhook(NOW + 60_000, renewal786())).toBe('duplicate');
		expect(await renewals(sub.id)).toHaveLength(1);
		expect((await eventsOf(sub.id)).filter((e) => e.type === 'subscription.renewed')).toHaveLength(1);
	});

	it('a late FAILED attempt for a period already credited changes nothing', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote()) });
		await reconcileRenewals(db, config, NOW);
		const failed = withField(withField(withField(renewal786(), 'invoiceId', '785'), 'completedAt', '"2026-01-27 00:00:30"'), 'status', '"FAILED"');
		expect(await webhook(NOW + 60_000, failed)).toBe('duplicate');
		expect((await subRow(sub.id)).status).toBe('active');
		expect((await eventsOf(sub.id)).map((e) => e.type)).toEqual(['subscription.renewed']);
	});

	it('credits a charge Bonum made on a retry days into the period, for that period', async () => {
		const sub = await seedMandate({ status: 'past_due' });
		fakeBonum({ [LIST]: listing(remote({ lastBilledAt: '2026-01-29 02:00:00' })) });
		await reconcileRenewals(db, config, at('2026-01-29 12:00:00'));
		expect(await renewals(sub.id)).toMatchObject([{ periodKey: new Date(DUE).toISOString() }]);
		expect((await subRow(sub.id)).status).toBe('active');
	});
});

describe('reconcileRenewals: other outcomes', () => {
	it('ends a subscription Bonum shows cancelled: provider_cancelled', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ status: 'CANCELLED', lastBilledAt: '2026-01-26 09:59:11' })) });
		await reconcileRenewals(db, config, NOW);
		expect(await subRow(sub.id)).toMatchObject({ status: 'cancelled', nextBillAt: null });
		const evs = await eventsOf(sub.id);
		expect(evs.map((e) => e.type)).toEqual(['subscription.cancelled']);
		expect(evs[0]!.data).toMatchObject({ reason: 'provider_cancelled' });
		expect(await renewals(sub.id)).toHaveLength(0);
		expect(await kinds(sub.id)).toContain('reconcile.provider_cancelled');
		const [c] = await db.select().from(card);
		expect(c).toMatchObject({ status: 'removed', tokenEnc: null });
	});

	it('credits a last billed period, then ends an UNSUBSCRIBED one', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ status: 'UNSUBSCRIBED' })) });
		await reconcileRenewals(db, config, NOW);
		expect((await eventsOf(sub.id)).map((e) => e.type)).toEqual(['subscription.renewed', 'subscription.cancelled']);
		expect(await renewals(sub.id)).toHaveLength(1);
	});

	it('not billed and still active: past due once, with renewal_missing', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ lastBilledAt: '2026-01-26 09:59:11', nextBillAt: '2026-01-27 00:00:00' })) });
		await reconcileRenewals(db, config, NOW);
		expect((await subRow(sub.id)).status).toBe('past_due');
		const evs = await eventsOf(sub.id);
		expect(evs.map((e) => e.type)).toEqual(['subscription.payment_failed']);
		expect(evs[0]!.data).toMatchObject({ reason: 'renewal_missing', nextBillAt: DUE });
		// Every later run asks again, but tells the project nothing new and notes it once a day.
		await reconcileRenewals(db, config, NOW + RECONCILE_RECLAIM_MS);
		await reconcileRenewals(db, config, NOW + 2 * RECONCILE_RECLAIM_MS);
		expect(await eventsOf(sub.id)).toHaveLength(1);
		expect((await kinds(sub.id)).filter((k) => k === 'reconcile.renewal_missing')).toHaveLength(1);
		await reconcileRenewals(db, config, NOW + NOTE_EVERY_MS + RECONCILE_RECLAIM_MS);
		expect((await kinds(sub.id)).filter((k) => k === 'reconcile.renewal_missing')).toHaveLength(2);
		expect(await eventsOf(sub.id)).toHaveLength(1);
		// When Bonum's retry finally succeeds, the next run credits it.
		fakeBonum({ [LIST]: listing(remote({ lastBilledAt: '2026-01-28 02:00:00' })) });
		await reconcileRenewals(db, config, NOW + NOTE_EVERY_MS + 2 * RECONCILE_RECLAIM_MS);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: at('2026-02-27 00:00:00') });
	});

	it('a Bonum error skips it, retries next run, and notes it at most once a day', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: () => jsonResponse({ message: 'down' }, 500) });
		await reconcileRenewals(db, config, NOW);
		await reconcileRenewals(db, config, NOW + RECONCILE_RECLAIM_MS);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: DUE });
		expect(await eventsOf(sub.id)).toHaveLength(0);
		expect((await kinds(sub.id)).filter((k) => k === 'reconcile.provider_error')).toHaveLength(1);
		await reconcileRenewals(db, config, NOW + NOTE_EVERY_MS + RECONCILE_RECLAIM_MS);
		expect((await kinds(sub.id)).filter((k) => k === 'reconcile.provider_error')).toHaveLength(2);
		fakeBonum({ [LIST]: listing(remote()) });
		await reconcileRenewals(db, config, NOW + NOTE_EVERY_MS + 2 * RECONCILE_RECLAIM_MS);
		expect(await renewals(sub.id)).toHaveLength(1);
	});

	it('skips a subscription missing from the list or with an unknown status', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ subscriptionId: 999 })) });
		await reconcileRenewals(db, config, NOW);
		fakeBonum({ [LIST]: listing(remote({ status: 'PAUSED', lastBilledAt: '2026-01-26 09:59:11' })) });
		await reconcileRenewals(db, config, NOW + RECONCILE_RECLAIM_MS);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: DUE });
		expect(await eventsOf(sub.id)).toHaveLength(0);
		expect(await kinds(sub.id)).toEqual(expect.arrayContaining(['reconcile.not_found', 'reconcile.unknown_status']));
	});

	it('only overdue live subscriptions, at most 50 per run, least recently asked first', async () => {
		const notYet = await seedMandate({ nextBillAt: NOW }, '1');
		const cancelled = await seedMandate({ status: 'cancelled' }, '2');
		const bonum = fakeBonum({ [LIST]: listing() });
		expect(await reconcileRenewals(db, config, NOW)).toBe(0);
		for (let i = 0; i < RECONCILE_BATCH + 3; i++) await seedMandate({}, String(100 + i));
		expect(await reconcileRenewals(db, config, NOW)).toBe(RECONCILE_BATCH);
		// Within the hour nothing is claimed again; then the 3 never asked go first.
		expect(await reconcileRenewals(db, config, NOW + 60_000)).toBe(3);
		expect(bonum.count(LIST)).toBe(RECONCILE_BATCH + 3);
		expect((await subRow(notYet.id)).reconciledAt).toBeNull();
		expect((await subRow(cancelled.id)).reconciledAt).toBeNull();
	});

	it('two overlapping runs ask about each subscription once', async () => {
		for (let i = 0; i < 4; i++) await seedMandate({}, String(200 + i));
		const bonum = fakeBonum({ [LIST]: listing() });
		const [a, b] = await Promise.all([reconcileRenewals(db, config, NOW), reconcileRenewals(db, config, NOW)]);
		expect(a + b).toBe(4);
		expect(bonum.count(LIST)).toBe(4);
	});

	it('does nothing when Bonum is off, and never rejects', async () => {
		await seedMandate();
		expect(await reconcileRenewals(db, testConfig({ bonum: null, providers: { bonum: false, qpay: true } }), NOW)).toBe(0);
		const broken = { select: () => { throw new Error('d1 down'); } } as unknown as TestDb;
		await expect(reconcileRenewals(broken, config, NOW)).resolves.toBe(0);
	});
});

describe('reconcileRenewals: what counts as billed', () => {
	it('(a) a lastBilledAt within a day of activation is the activation charge, not a renewal', async () => {
		// CARD-TOKEN carried no amount: no activation ledger row, so our last credit is the period start.
		const sub = await seedMandate();
		await db.delete(ledger).where(eq(ledger.subjectId, sub.id));
		fakeBonum({ [LIST]: listing(remote({ lastBilledAt: '2026-01-26 10:00:05', nextBillAt: '2026-02-27 00:00:00' })) });
		await reconcileRenewals(db, config, NOW);
		expect(await renewals(sub.id)).toHaveLength(0);
		expect(await kinds(sub.id)).not.toContain('reconcile.period_unknown');
		expect((await eventsOf(sub.id)).map((e) => e.type)).toEqual(['subscription.payment_failed']);
		expect((await subRow(sub.id)).status).toBe('past_due');
	});

	it('(a) a charge the day after activation that is at our due date is still a renewal', async () => {
		// Bonum's sample: subscribed 2026-01-26 09:59, first billing date the next day.
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote()) });
		await reconcileRenewals(db, config, NOW);
		expect(await renewals(sub.id)).toHaveLength(1);
	});

	it('(b) a declined attempt (lastBilledAt newer, nextBillAt not moved on) is not billed', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ lastBilledAt: '2026-01-27 02:00:08', nextBillAt: '2026-01-27 00:00:00' })) });
		await reconcileRenewals(db, config, NOW);
		expect(await renewals(sub.id)).toHaveLength(0);
		expect((await subRow(sub.id)).status).toBe('past_due');
		expect((await eventsOf(sub.id))[0]!.data).toMatchObject({ reason: 'renewal_missing' });
		// Nor a schedule Bonum moved by only hours (billing off our dates).
		const other = await seedMandate({}, '42');
		fakeBonum({ [LIST]: listing(remote({ subscriptionId: 42, nextBillAt: '2026-01-27 20:00:00' })) });
		await reconcileRenewals(db, config, NOW);
		expect(await renewals(other.id)).toHaveLength(0);
	});

	it('(b) a new charge with no next bill date is unclear: skipped and noted, not credited or marked', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ nextBillAt: null })) });
		await reconcileRenewals(db, config, NOW);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: DUE });
		expect(await eventsOf(sub.id)).toHaveLength(0);
		expect(await kinds(sub.id)).toContain('reconcile.schedule_unknown');
	});

	it('(c) a billed charge whose period is already credited is held: rechecked daily, noted once a day', async () => {
		const sub = await seedMandate();
		// The period is credited, yet the subscription never moved on (a stuck state).
		await db.insert(ledger).values({
			id: newId(),
			projectId,
			provider: 'bonum',
			providerRef: 'sub-invoice:700',
			kind: 'subscription',
			subjectId: sub.id,
			amount: 3,
			periodKey: new Date(DUE).toISOString(),
			createdAt: at('2026-01-27 01:00:00')
		});
		const bonum = fakeBonum({ [LIST]: listing(remote()) });
		await reconcileRenewals(db, config, NOW);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: DUE, reconciledAt: NOW + RECONCILE_HOLD_MS - RECONCILE_RECLAIM_MS });
		expect((await kinds(sub.id)).filter((k) => k === 'reconcile.period_conflict')).toHaveLength(1);
		// Not asked hourly.
		for (let h = 1; h < 24; h++) await reconcileRenewals(db, config, NOW + h * 3600_000);
		expect(bonum.count(LIST)).toBe(1);
		// A day on: asked again, noted again, still nothing credited or emitted.
		await reconcileRenewals(db, config, NOW + RECONCILE_HOLD_MS);
		expect(bonum.count(LIST)).toBe(2);
		expect((await kinds(sub.id)).filter((k) => k === 'reconcile.period_conflict')).toHaveLength(2);
		expect(await eventsOf(sub.id)).toHaveLength(0);
		expect(await renewals(sub.id)).toHaveLength(1);
	});

	it('(c) a billed charge that fits no billing period is held too', async () => {
		const sub = await seedMandate({ billingAnchor: at('2026-02-27 00:00:00') });
		const bonum = fakeBonum({ [LIST]: listing(remote({ nextBillAt: '2026-03-27 00:00:00' })) });
		await reconcileRenewals(db, config, NOW);
		await reconcileRenewals(db, config, NOW + RECONCILE_RECLAIM_MS);
		expect(bonum.count(LIST)).toBe(1);
		expect(await kinds(sub.id)).toEqual(['reconcile.period_unknown']);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', reconciledAt: NOW + RECONCILE_HOLD_MS - RECONCILE_RECLAIM_MS });
	});

	it('(d) reads date-only lastBilledAt and nextBillAt as 00:00 Ulaanbaatar time', async () => {
		const sub = await seedMandate();
		fakeBonum({ [LIST]: listing(remote({ lastBilledAt: '2026-01-27', nextBillAt: '2026-02-27' })) });
		await reconcileRenewals(db, config, NOW);
		expect(await renewals(sub.id)).toMatchObject([{ periodKey: new Date(DUE).toISOString() }]);
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: at('2026-02-27 00:00:00') });
		// Unmoved, date only: a declined attempt.
		const other = await seedMandate({}, '43');
		fakeBonum({ [LIST]: listing(remote({ subscriptionId: 43, lastBilledAt: '2026-01-27', nextBillAt: '2026-01-27' })) });
		await reconcileRenewals(db, config, NOW);
		expect(await renewals(other.id)).toHaveLength(0);
		expect((await subRow(other.id)).status).toBe('past_due');
	});
});

describe('SUBSCRIPTION-PAYMENT period guard', () => {
	it('a second real charge for the same scheduled period is still credited, and flagged', async () => {
		const sub = await seedMandate();
		expect(await webhook(at('2026-01-27 02:00:10'), renewal786())).toBe('processed');
		const second = withField(withField(renewal786(), 'invoiceId', '790'), 'completedAt', '"2026-01-27 05:00:00"');
		expect(await webhook(at('2026-01-27 05:00:10'), second)).toBe('processed');
		const rows = await renewals(sub.id);
		expect(rows.map((r) => r.providerRef).sort()).toEqual(['sub-invoice:786', 'sub-invoice:790']);
		expect(rows.find((r) => r.providerRef === 'sub-invoice:790')!.periodKey).toBe(`${new Date(DUE).toISOString()}:790`);
		expect(await kinds(sub.id)).toContain('bonum.subscription_payment.same_period');
	});
});
