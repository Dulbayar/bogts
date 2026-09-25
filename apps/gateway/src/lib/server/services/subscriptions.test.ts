import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { encrypt } from '../crypto';
import { newId } from '../ids';
import { resetBonumTokenCache } from '../providers/bonum/client';
import { fakeBonum, jsonResponse } from '../providers/bonum/testing';
import { card as cardTable, event, subscription as subTable, type Plan, type Project } from '../schema';
import { createTestDb, seedPlan, seedProject, TEST_ENCRYPTION_KEY, testConfig, type TestDb } from '../testdb';
import type { ServiceContext } from './context';
import {
	cancelSubscription,
	SubscriptionListQuery,
	createSubscription,
	getSubscription,
	listSubscriptions,
	PENDING_CHECKOUT_TTL_MS,
	replaceCard
} from './subscriptions';

const PLANS = 'GET /mpay-service/merchant/values/payment-plans';
const TOKENIZE = 'POST /mpay-service/merchant/cards/tokenize/request';
const plansOk = () => jsonResponse({ data: [{ planId: 166, name: 'Pro', recurringType: 'MONTHLY', amount: 49900.0, status: 'ACTIVE' }] });
const tokenizeOk = () => jsonResponse({ followUpLink: 'https://ecommerce.bonum.mn/tokenize?id=73c6', id: '73c6' });

let db: TestDb;
let ctx: ServiceContext;
let project: Project;
let plan: Plan;

beforeEach(async () => {
	db = createTestDb();
	ctx = { db, config: testConfig(), now: Date.UTC(2026, 8, 25, 4) };
	project = (await seedProject(db)).project;
	plan = await seedPlan(db, project.id, { key: 'pro-monthly', providerPlanId: 166, amount: 49_900, interval: 'monthly' });
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

const input = { plan: 'pro-monthly', customerRef: 'shop-1', email: 'owner@example.com', returnUrl: 'https://project.test/billing' };

async function activeSub(overrides: Partial<typeof subTable.$inferInsert> = {}) {
	const cardId = newId();
	await db.insert(cardTable).values({
		id: cardId,
		projectId: project.id,
		customerRef: 'shop-1',
		tokenEnc: await encrypt('card-token-1', TEST_ENCRYPTION_KEY),
		mask: '5150 23** **** 4778',
		expiry: '2026/11',
		bankName: 'Голомт банк',
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
		currentPeriodEnd: ctx.now! + 30 * 86_400_000,
		nextBillAt: ctx.now! + 30 * 86_400_000,
		returnUrl: 'https://project.test/billing',
		createdAt: ctx.now!,
		updatedAt: ctx.now!,
		...overrides
	});
	return { id, cardId };
}

describe('createSubscription', () => {
	it('validates the plan, then tokenizes with a payNow subscription', async () => {
		const bonum = fakeBonum({ [PLANS]: plansOk, [TOKENIZE]: tokenizeOk });
		const sub = await createSubscription(ctx, project, input);
		expect(sub).toMatchObject({
			object: 'subscription',
			plan: 'pro-monthly',
			customerRef: 'shop-1',
			email: 'owner@example.com',
			status: 'pending',
			redirectUrl: 'https://ecommerce.bonum.mn/tokenize?id=73c6',
			card: null,
			currentPeriod: null,
			nextBillAt: null,
			cancelledAt: null,
			createdAt: '2026-09-25T04:00:00.000Z'
		});
		const [call] = bonum.to(TOKENIZE);
		expect(call!.body).toEqual({
			callback: `https://payments.test/return/s/${sub.id}`,
			transactionId: sub.id,
			subscription: { planId: 166, cycleValue: '25', cycles: null, payNow: true, custEmail: 'owner@example.com' },
			// Bonum's sandbox refuses an item without `image` and `remark`.
			items: [{ image: '', title: 'Pro (monthly)', remark: '', amount: 49_900, count: 1 }]
		});
		expect(bonum.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
			'GET /bonum-gateway/ecommerce/auth/create',
			PLANS,
			TOKENIZE
		]);
	});

	it('refuses with plan_mismatch and never tokenizes', async () => {
		const bonum = fakeBonum({
			[PLANS]: () => jsonResponse({ data: [{ planId: 166, name: 'Pro', recurringType: 'YEARLY', amount: 49900, status: 'ACTIVE' }] }),
			[TOKENIZE]: tokenizeOk
		});
		const err = await createSubscription(ctx, project, input).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({ status: 409, code: 'plan_mismatch' });
		expect(bonum.count(TOKENIZE)).toBe(0);
		expect(await db.select().from(subTable)).toHaveLength(0);
	});

	it('refuses an unknown plan and a second live subscription', async () => {
		fakeBonum({ [PLANS]: plansOk, [TOKENIZE]: tokenizeOk });
		await expect(createSubscription(ctx, project, { ...input, plan: 'nope' })).rejects.toMatchObject({ status: 400 });
		await activeSub();
		await expect(createSubscription(ctx, project, input)).rejects.toMatchObject({ status: 409, code: 'conflict' });
	});

	it('a stale pending checkout no longer blocks', async () => {
		fakeBonum({ [PLANS]: plansOk, [TOKENIZE]: tokenizeOk });
		const first = await createSubscription(ctx, project, input);
		await expect(createSubscription(ctx, project, input)).rejects.toMatchObject({ status: 409 });
		ctx.now = ctx.now! + PENDING_CHECKOUT_TTL_MS + 1;
		const second = await createSubscription(ctx, project, input);
		expect(second.id).not.toBe(first.id);
		expect((await getSubscription(ctx, project.id, first.id)).status).toBe('failed');
	});

	it('marks the row failed and answers provider_error when Bonum refuses', async () => {
		fakeBonum({ [PLANS]: plansOk, [TOKENIZE]: () => jsonResponse({ message: 'Алдаа' }, 500) });
		await expect(createSubscription(ctx, project, input)).rejects.toMatchObject({ status: 502, code: 'provider_error' });
		const [row] = await db.select().from(subTable);
		expect(row!.status).toBe('failed');
		// Like invoice.failed: the project hears it, once.
		const events = await db.select().from(event);
		expect(events.map((e) => e.type)).toEqual(['subscription.payment_failed']);
		expect(events[0]!.data).toMatchObject({ subscriptionId: row!.id, reason: 'checkout_failed', nextBillAt: null });
		// A failed CARD-TOKEN for the same checkout arriving later changes nothing.
		const { handleBonumWebhook } = await import('../providers/bonum/webhook');
		const late = { type: 'CARD-TOKEN', status: 'FAILED', message: '', body: { transactionId: row!.tokenizeTransactionId } };
		expect(await handleBonumWebhook(ctx, late)).toBe('ignored');
		expect(await db.select().from(event)).toHaveLength(1);
	});

	it('refuses an untrusted follow-up link', async () => {
		fakeBonum({ [PLANS]: plansOk, [TOKENIZE]: () => jsonResponse({ followUpLink: 'https://phish.example/tokenize', id: 'x' }) });
		await expect(createSubscription(ctx, project, input)).rejects.toMatchObject({ code: 'provider_error' });
	});
});

describe('cancelSubscription', () => {
	it('deletes at Bonum with planId, then cancels once', async () => {
		const { id, cardId } = await activeSub();
		const bonum = fakeBonum({ 'DELETE /mpay-service/merchant/subscriptions/41/delete': () => jsonResponse({ status: 200 }) });
		const sub = await cancelSubscription(ctx, project.id, id);
		expect(sub).toMatchObject({ status: 'cancelled', card: null, nextBillAt: null, cancelledAt: '2026-09-25T04:00:00.000Z' });
		const [call] = bonum.to('DELETE /mpay-service/merchant/subscriptions/41/delete');
		expect(call!.body).toEqual({ planId: 166 });
		expect(call!.headers.get('x-card-token')).toBe('card-token-1');
		const [card] = await db.select().from(cardTable).where(eq(cardTable.id, cardId));
		expect(card).toMatchObject({ status: 'removed', tokenEnc: null });

		await cancelSubscription(ctx, project.id, id);
		expect(bonum.count('DELETE /mpay-service/merchant/subscriptions/41/delete')).toBe(1);
		const evs = await db.select().from(event);
		expect(evs.map((e) => [e.type, (e.data as { reason?: string }).reason])).toEqual([['subscription.cancelled', 'cancelled_by_project']]);
	});

	it('treats a 404 from Bonum as already gone; an admin actor is recorded as the reason', async () => {
		const { id } = await activeSub();
		fakeBonum({ 'DELETE /mpay-service/merchant/subscriptions/41/delete': () => jsonResponse({}, 404) });
		expect((await cancelSubscription(ctx, project.id, id, 'password')).status).toBe('cancelled');
		const [e] = await db.select().from(event);
		expect(e!.data).toMatchObject({ reason: 'cancelled_by_admin' });
	});

	it('keeps the subscription when Bonum refuses', async () => {
		const { id } = await activeSub();
		fakeBonum({ 'DELETE /mpay-service/merchant/subscriptions/41/delete': () => jsonResponse({}, 500) });
		await expect(cancelSubscription(ctx, project.id, id)).rejects.toMatchObject({ status: 502 });
		expect((await getSubscription(ctx, project.id, id)).status).toBe('active');
		expect(await db.select().from(event)).toHaveLength(0);
	});

	it('refuses (409) and keeps the subscription when there is no Bonum subscription id', async () => {
		for (const status of ['active', 'past_due'] as const) {
			const { id } = await activeSub({ status, providerSubscriptionId: null });
			const bonum = fakeBonum({});
			await expect(cancelSubscription(ctx, project.id, id)).rejects.toMatchObject({
				status: 409,
				code: 'conflict',
				message: 'This subscription has no Bonum subscription id; cancel it in the Bonum merchant portal.'
			});
			expect(bonum.calls).toHaveLength(0);
			expect((await getSubscription(ctx, project.id, id)).status).toBe(status);
		}
		expect(await db.select().from(event)).toHaveLength(0);
	});

	it('404s for another project', async () => {
		const { id } = await activeSub();
		const other = (await seedProject(db)).project;
		await expect(cancelSubscription(ctx, other.id, id)).rejects.toMatchObject({ status: 404 });
	});
});

describe('replaceCard', () => {
	it('starts a card change with callback and a fresh transactionId', async () => {
		const { id } = await activeSub();
		const CHANGE = 'PUT /mpay-service/merchant/subscriptions/41/change/create-new-token';
		const bonum = fakeBonum({ [CHANGE]: () => jsonResponse({ followUpLink: 'https://ecommerce.bonum.mn/tokenize?id=rc', id: 'rc' }) });
		const sub = await replaceCard(ctx, project.id, id);
		expect(sub).toMatchObject({ status: 'active', redirectUrl: 'https://ecommerce.bonum.mn/tokenize?id=rc' });
		expect(sub.card).toMatchObject({ mask: '5150 23** **** 4778' });
		const [call] = bonum.to(CHANGE);
		const body = call!.body as { callback: string; transactionId: string };
		expect(body.callback).toBe(`https://payments.test/return/s/${id}`);
		const [row] = await db.select().from(subTable).where(eq(subTable.id, id));
		expect(body.transactionId).toBe(row!.pendingTransactionId);
		expect(body.transactionId).not.toBe(row!.tokenizeTransactionId);
	});

	it('refuses a cancelled subscription', async () => {
		const { id } = await activeSub({ status: 'cancelled' });
		await expect(replaceCard(ctx, project.id, id)).rejects.toMatchObject({ status: 409 });
	});
});

describe('listSubscriptions', () => {
	it('pages newest first and filters', async () => {
		const ids = [];
		for (let i = 0; i < 3; i++) ids.push((await activeSub({ customerRef: `c-${i}`, providerSubscriptionId: `4${i}0` })).id);
		const page1 = await listSubscriptions(ctx, project.id, { limit: 2 });
		expect(page1.object).toBe('list');
		expect(page1.data.map((s) => s.id)).toEqual([ids[2], ids[1]]);
		expect(page1.hasMore).toBe(true);
		const page2 = await listSubscriptions(ctx, project.id, { limit: 2, cursor: page1.nextCursor! });
		expect(page2).toMatchObject({ hasMore: false, nextCursor: null });
		expect(page2.data.map((s) => s.id)).toEqual([ids[0]]);
		const lower = await listSubscriptions(ctx, project.id, SubscriptionListQuery.parse({ limit: '2', cursor: page1.nextCursor!.toLowerCase() }));
		expect(lower.data.map((s) => s.id)).toEqual([ids[0]]);
		const filtered = await listSubscriptions(ctx, project.id, { limit: 20, customerRef: 'c-1' });
		expect(filtered.data.map((s) => s.id)).toEqual([ids[1]]);
	});
});
