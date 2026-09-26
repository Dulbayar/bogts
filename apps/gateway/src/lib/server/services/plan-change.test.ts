import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { encrypt } from '../crypto';
import { newId } from '../ids';
import { resetBonumTokenCache } from '../providers/bonum/client';
import { fakeBonum, jsonResponse } from '../providers/bonum/testing';
import { firstBillDate } from '../providers/bonum/util';
import { handleBonumWebhook } from '../providers/bonum/webhook';
import { activity, card as cardTable, event, subscription as subTable, type Plan, type Project } from '../schema';
import { createTestDb, seedPlan, seedProject, TEST_ENCRYPTION_KEY, testConfig, type TestDb } from '../testdb';
import type { ServiceContext } from './context';
import { applyPlanChanges, changePlan, planChangeFits } from './plan-change';
import { cancelSubscription, getSubscription, listSubscriptions } from './subscriptions';

const PLANS = 'GET /mpay-service/merchant/values/payment-plans';
const SUBSCRIBE = 'POST /mpay-service/merchant/subscriptions/subscribe';
const del = (id: string | number) => `DELETE /mpay-service/merchant/subscriptions/${id}/delete`;
const plansOk = () =>
	jsonResponse({
		data: [
			{ planId: 166, name: 'Pro', recurringType: 'MONTHLY', amount: 49900.0, status: 'ACTIVE' },
			{ planId: 167, name: 'Pro yearly', recurringType: 'YEARLY', amount: 499000.0, status: 'ACTIVE' }
		]
	});
const subscribed = (nextBillAt: string, subscriptionId = 77) => () =>
	jsonResponse({ data: { subscriptionId, subscribedAt: '2026-09-25 12:00:01', nextBillAt, lastBilledAt: null, status: 'ACTIVE' } }, 201);
const deleted = () => jsonResponse({ data: null, status: 200 });

const DAY = 86_400_000;
/** 12:00 in Ulaanbaatar on that date. */
const ub = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h - 8);

let db: TestDb;
let ctx: ServiceContext;
let project: Project;
let monthly: Plan;
let yearly: Plan;

beforeEach(async () => {
	db = createTestDb();
	ctx = { db, config: testConfig(), now: ub(2026, 9, 25) };
	project = (await seedProject(db)).project;
	monthly = await seedPlan(db, project.id, { key: 'pro-monthly', providerPlanId: 166, amount: 49_900, interval: 'monthly' });
	yearly = await seedPlan(db, project.id, { key: 'pro-yearly', providerPlanId: 167, amount: 499_000, interval: 'yearly' });
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

async function activeSub(plan: Plan, nextBillAt: number, overrides: Partial<typeof subTable.$inferInsert> = {}) {
	const cardId = newId();
	await db.insert(cardTable).values({
		id: cardId,
		projectId: project.id,
		customerRef: 'shop-1',
		tokenEnc: await encrypt('card-token-1', TEST_ENCRYPTION_KEY),
		mask: '5150 23** **** 4778',
		createdAt: ctx.now!,
		updatedAt: ctx.now!
	});
	const id = newId();
	await db.insert(subTable).values({
		id,
		projectId: project.id,
		planId: plan.id,
		customerRef: 'shop-1',
		status: 'active',
		providerSubscriptionId: '41',
		tokenizeTransactionId: id,
		cardId,
		currentPeriodStart: ctx.now!,
		currentPeriodEnd: nextBillAt,
		nextBillAt,
		billingAnchor: nextBillAt,
		returnUrl: 'https://project.test/billing',
		createdAt: ctx.now!,
		updatedAt: ctx.now!,
		...overrides
	});
	return id;
}

const row = async (id: string) => (await db.select().from(subTable).where(eq(subTable.id, id)))[0]!;
const events = async (type: string) => (await db.select().from(event)).filter((e) => e.type === type);

describe('firstBillDate / planChangeFits', () => {
	it('finds the next matching day, never today', () => {
		// 25 Sep 2026: monthly day 30 is this month, day 25 is today (Bonum would charge now).
		expect(firstBillDate('monthly', 30, ub(2026, 9, 25))).toBe(ub(2026, 9, 30, 0));
		expect(firstBillDate('monthly', 25, ub(2026, 9, 25))).toBeNull();
		expect(firstBillDate('monthly', 3, ub(2026, 9, 25))).toBe(ub(2026, 10, 3, 0));
		// Day of year 298 = 25 Oct 2026.
		expect(firstBillDate('yearly', 298, ub(2026, 9, 25))).toBe(ub(2026, 10, 25, 0));
		// Day 31 skips 30-day months.
		expect(firstBillDate('monthly', 31, ub(2026, 11, 2))).toBe(ub(2026, 12, 31, 0));
	});

	it('monthly → yearly fits at once; yearly → monthly only in the last month', () => {
		expect(planChangeFits('yearly', ub(2026, 10, 25), ub(2026, 9, 25))).toBe(true);
		const billAt = ub(2027, 9, 1);
		expect(planChangeFits('monthly', billAt, ub(2026, 9, 25))).toBe(false);
		expect(planChangeFits('monthly', billAt, ub(2027, 7, 31))).toBe(false);
		expect(planChangeFits('monthly', billAt, ub(2027, 8, 1))).toBe(false); // the cycle day itself
		expect(planChangeFits('monthly', billAt, ub(2027, 8, 2))).toBe(true);
		expect(planChangeFits('monthly', billAt, ub(2027, 8, 31))).toBe(true);
		// Too close to the bill.
		expect(planChangeFits('monthly', billAt, billAt - 2 * 3600_000)).toBe(false);
	});
});

describe('changePlan monthly → yearly', () => {
	it('subscribes the saved card to the yearly plan from nextBillAt, then deletes the monthly one', async () => {
		const billAt = ub(2026, 10, 25);
		const id = await activeSub(monthly, billAt);
		const bonum = fakeBonum({ [PLANS]: plansOk, [SUBSCRIBE]: subscribed('2026-10-25 00:00:00'), [del(41)]: deleted });

		const json = await changePlan(ctx, project.id, id, { plan: 'pro-yearly' });

		expect(json).toMatchObject({ plan: 'pro-yearly', nextPlan: null, nextBillAt: new Date(ub(2026, 10, 25, 0)).toISOString() });
		const [sub] = bonum.to(SUBSCRIBE);
		expect(sub!.headers.get('x-card-token')).toBe('card-token-1');
		expect(sub!.body).toEqual({ planId: 167, cycleValue: 298, cycles: null, payNow: false });
		expect(bonum.to(del(41))[0]!.body).toEqual({ planId: 166 });

		const after = await row(id);
		expect(after).toMatchObject({
			planId: yearly.id,
			providerSubscriptionId: '77',
			nextPlanId: null,
			retiringProviderSubscriptionId: null,
			retiringProviderPlanId: null,
			billingAnchor: ub(2026, 10, 25, 0),
			// The paid monthly period is untouched.
			currentPeriodEnd: billAt
		});
		const [changed] = await events('subscription.plan_changed');
		expect(changed!.data).toMatchObject({ plan: 'pro-yearly', previousPlan: 'pro-monthly', amount: 499_000 });
	});

	it('keeps the change scheduled and undoes Bonum\'s subscription when it would bill another day', async () => {
		const id = await activeSub(monthly, ub(2026, 10, 25));
		const bonum = fakeBonum({ [PLANS]: plansOk, [SUBSCRIBE]: subscribed('2026-09-26 00:00:00'), [del(77)]: deleted });

		const json = await changePlan(ctx, project.id, id, { plan: 'pro-yearly' });

		expect(json).toMatchObject({ plan: 'pro-monthly', nextPlan: { plan: 'pro-yearly' } });
		expect(bonum.count(del(77))).toBe(1);
		expect(bonum.count(del(41))).toBe(0);
		expect(await row(id)).toMatchObject({ providerSubscriptionId: '41', nextPlanId: yearly.id, planChangeTriedAt: ctx.now });
		expect((await db.select().from(activity)).map((a) => a.kind)).toContain('bonum.plan_change.date_mismatch');
	});

	it('stays scheduled when Bonum refuses, and the cron tries again an hour later', async () => {
		const id = await activeSub(monthly, ub(2026, 10, 25));
		fakeBonum({ [PLANS]: plansOk, [SUBSCRIBE]: () => jsonResponse({ message: 'subscription.process.waiting', status: 429 }, 429) });
		const json = await changePlan(ctx, project.id, id, { plan: 'pro-yearly' });
		expect(json.nextPlan).toMatchObject({ plan: 'pro-yearly' });

		const bonum = fakeBonum({ [PLANS]: plansOk, [SUBSCRIBE]: subscribed('2026-10-25 00:00:00'), [del(41)]: deleted });
		expect(await applyPlanChanges(db, ctx.config, ctx.now! + 10 * 60_000)).toEqual({ retired: 0, applied: 0 });
		expect(bonum.count(SUBSCRIBE)).toBe(0);
		expect(await applyPlanChanges(db, ctx.config, ctx.now! + 60 * 60_000)).toEqual({ retired: 0, applied: 1 });
		expect(await row(id)).toMatchObject({ planId: yearly.id, providerSubscriptionId: '77' });
	});

	it('keeps a replaced subscription it could not delete, and deletes it later', async () => {
		const id = await activeSub(monthly, ub(2026, 10, 25));
		fakeBonum({ [PLANS]: plansOk, [SUBSCRIBE]: subscribed('2026-10-25 00:00:00'), [del(41)]: () => jsonResponse({}, 500) });
		await changePlan(ctx, project.id, id, { plan: 'pro-yearly' });
		expect(await row(id)).toMatchObject({ providerSubscriptionId: '77', retiringProviderSubscriptionId: '41', retiringProviderPlanId: 166 });

		const bonum = fakeBonum({ [del(41)]: deleted });
		expect(await applyPlanChanges(db, ctx.config, ctx.now! + 60 * 60_000)).toEqual({ retired: 1, applied: 0 });
		expect(bonum.to(del(41))[0]!.body).toEqual({ planId: 166 });
		expect(await row(id)).toMatchObject({ retiringProviderSubscriptionId: null, retiringProviderPlanId: null });
	});
});

describe('changePlan yearly → monthly', () => {
	const billAt = ub(2027, 9, 1);

	it('waits until the last month of the paid year, then switches in the cron', async () => {
		const id = await activeSub(yearly, billAt);
		const bonum = fakeBonum({ [PLANS]: plansOk, [SUBSCRIBE]: subscribed('2027-09-01 00:00:00'), [del(41)]: deleted });

		const json = await changePlan(ctx, project.id, id, { plan: 'pro-monthly' });
		expect(json).toMatchObject({ plan: 'pro-yearly', nextPlan: { plan: 'pro-monthly', at: new Date(billAt).toISOString() } });
		expect(bonum.count(SUBSCRIBE)).toBe(0);
		expect((await listSubscriptions(ctx, project.id, { limit: 10 })).data[0]!.nextPlan).toMatchObject({ plan: 'pro-monthly' });

		expect(await applyPlanChanges(db, ctx.config, ub(2027, 7, 31))).toEqual({ retired: 0, applied: 0 });
		expect(bonum.count(SUBSCRIBE)).toBe(0);
		expect(await applyPlanChanges(db, ctx.config, ub(2027, 8, 2))).toEqual({ retired: 0, applied: 1 });
		expect(bonum.to(SUBSCRIBE)[0]!.body).toEqual({ planId: 166, cycleValue: 1, cycles: null, payNow: false });
		expect(await getSubscription(ctx, project.id, id)).toMatchObject({ plan: 'pro-monthly', nextPlan: null });
	});

	it('undoes the scheduled change when asked for the current plan', async () => {
		const id = await activeSub(yearly, billAt);
		fakeBonum({ [PLANS]: plansOk });
		await changePlan(ctx, project.id, id, { plan: 'pro-monthly' });
		const json = await changePlan(ctx, project.id, id, { plan: 'pro-yearly' });
		expect(json).toMatchObject({ plan: 'pro-yearly', nextPlan: null });
		expect(await row(id)).toMatchObject({ nextPlanId: null });
	});

	it('cancelling drops the scheduled change', async () => {
		const id = await activeSub(yearly, billAt);
		fakeBonum({ [PLANS]: plansOk, [del(41)]: deleted });
		await changePlan(ctx, project.id, id, { plan: 'pro-monthly' });
		await cancelSubscription(ctx, project.id, id);
		expect(await row(id)).toMatchObject({ status: 'cancelled', nextPlanId: null });
		expect(await applyPlanChanges(db, ctx.config, ub(2027, 8, 2))).toEqual({ retired: 0, applied: 0 });
	});
});

describe('guards', () => {
	it('refuses a past_due subscription and an unknown plan', async () => {
		const id = await activeSub(monthly, ub(2026, 10, 25), { status: 'past_due' });
		fakeBonum({ [PLANS]: plansOk });
		await expect(changePlan(ctx, project.id, id, { plan: 'pro-yearly' })).rejects.toMatchObject({ status: 409 });
		const other = await activeSub(monthly, ub(2026, 10, 25), { providerSubscriptionId: '42' });
		const err = await changePlan(ctx, project.id, other, { plan: 'nope' }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({ status: 400 });
	});

	it('cancel also deletes a replaced Bonum subscription still standing', async () => {
		const id = await activeSub(yearly, ub(2026, 10, 25), { providerSubscriptionId: '77', retiringProviderSubscriptionId: '41', retiringProviderPlanId: 166 });
		const bonum = fakeBonum({ [del(41)]: deleted, [del(77)]: deleted });
		await cancelSubscription(ctx, project.id, id);
		expect(bonum.to(del(41))[0]!.body).toEqual({ planId: 166 });
		expect(bonum.to(del(77))[0]!.body).toEqual({ planId: 167 });
		expect(await row(id)).toMatchObject({ status: 'cancelled', retiringProviderSubscriptionId: null });
	});

	it("an UNSUBSCRIBED for the replaced Bonum subscription does not end the new one", async () => {
		const id = await activeSub(yearly, ub(2026, 10, 25), { providerSubscriptionId: '77' });
		const result = await handleBonumWebhook(ctx, {
			type: 'UNSUBSCRIBED',
			status: 'SUCCESS',
			body: { subscriptionId: 41, planId: 166, transactionId: id, completedAt: '2026-09-25 12:00:08' }
		});
		expect(result).toBe('ignored');
		expect(await row(id)).toMatchObject({ status: 'active' });
	});

	it('the first bill on the new plan is credited as a yearly renewal', async () => {
		const id = await activeSub(yearly, ub(2026, 10, 25, 0), { providerSubscriptionId: '77', billingAnchor: ub(2026, 10, 25, 0) });
		ctx.now = ub(2026, 10, 25, 2);
		const result = await handleBonumWebhook(ctx, {
			type: 'SUBSCRIPTION-PAYMENT',
			status: 'SUCCESS',
			body: { subscriptionId: 77, invoiceId: 900, planId: 167, transactionId: id, completedAt: '2026-10-25 02:00:08', amount: 499000.0, currency: 'MNT' }
		});
		expect(result).toBe('processed');
		const after = await row(id);
		expect(after.currentPeriodStart).toBe(ub(2026, 10, 25, 0));
		expect(after.nextBillAt).toBe(ub(2027, 10, 25, 0));
		expect(after.nextBillAt! - after.currentPeriodStart!).toBe(365 * DAY);
	});
});
