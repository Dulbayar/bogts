import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '../api/errors';
import { encrypt } from '../crypto';
import { idempotent } from '../idempotency';
import { newId } from '../ids';
import { resetBonumTokenCache } from '../providers/bonum/client';
import { AUTH_CREATE, fakeBonum, jsonResponse, type FakeRoute } from '../providers/bonum/testing';
import { handleBonumWebhook } from '../providers/bonum/webhook';
import { card as cardTable, charge as chargeTable, event, ledger, subscription as subTable, type Project } from '../schema';
import { createTestDb, seedPlan, seedProject, TEST_ENCRYPTION_KEY, testConfig, type TestDb } from '../testdb';
import { createCharge, getCharge, listCharges, reverseCharge } from './charges';
import type { ServiceContext } from './context';

const PURCHASE = 'POST /mpay-service/merchant/transaction/purchase';

/* Bonum's purchase samples. */
const purchaseSuccess = () =>
	jsonResponse({
		traceId: '6965c23f4a88878d6f11b97bd0dc4f57',
		errorCode: '${invalid.bonum.response.00}',
		error: null,
		message: 'Төлбөр амжилттай хийгдлээ (00)',
		data: { id: 172345, completedAt: '2026-01-13 11:55:44', status: 'SUCCESS', description: '', cardStatus: 'ACTIVE' },
		detail: null,
		duration: 759,
		status: 200
	});
const purchaseDeclined = () =>
	jsonResponse(
		{
			traceId: '6965b3f57a560ad2d5d7dcd0bccedcfe',
			errorCode: '${invalid.bonum.response.56}',
			error: null,
			message: 'Картаар төлбөр хийх боломжгүй (56)',
			data: { id: 171044, completedAt: '2026-01-13 10:54:46', status: 'FAILED', description: '', cardStatus: 'INACTIVE' },
			detail: null,
			duration: 635,
			status: 400
		},
		400
	);
const purchaseQueued = () =>
	jsonResponse(
		{
			traceId: '697088018770d01b18064d81cef5f504',
			errorCode: 'QUEUED',
			error: null,
			message: 'bonum.token.invoice.queued',
			data: { id: 662, completedAt: '2026-01-21 16:02:10', status: 'QUEUED', description: '', cardStatus: null, respCode: null },
			detail: null,
			duration: 1192,
			status: 201
		},
		201
	);
const purchaseBusy = () =>
	jsonResponse({ traceId: 't', errorCode: null, error: null, message: 'subscription.process.waiting', data: null, detail: null, duration: 4035, status: 429 }, 429);

let db: TestDb;
let ctx: ServiceContext;
let project: Project;
let subscriptionId: string;

beforeEach(async () => {
	db = createTestDb();
	ctx = { db, config: testConfig(), now: Date.UTC(2026, 8, 25, 4) };
	project = (await seedProject(db)).project;
	const plan = await seedPlan(db, project.id);
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
	subscriptionId = newId();
	await db.insert(subTable).values({
		id: subscriptionId,
		projectId: project.id,
		planId: plan.id,
		customerRef: 'shop-1',
		status: 'active',
		providerSubscriptionId: '41',
		tokenizeTransactionId: subscriptionId,
		cardId,
		createdAt: ctx.now!,
		updatedAt: ctx.now!
	});
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

const charge = (route: FakeRoute) => {
	const bonum = fakeBonum({ [PURCHASE]: route });
	return { bonum, run: () => createCharge(ctx, project, { subscriptionId, amount: 15_000, reference: 'extra-1' }) };
};
const types = async () => (await db.select().from(event)).map((e) => e.type);

describe('createCharge', () => {
	it('with an Idempotency-Key, a D1 failure after Bonum charged is replayed, never charged again', async () => {
		const bonum = fakeBonum({
			[PURCHASE]: () => {
				// Bonum takes the money; then D1 fails while we record it.
				vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('D1_ERROR'));
				return purchaseSuccess();
			}
		});
		const input = { projectId: project.id, key: 'charge-key', method: 'POST', path: '/v1/charges', body: '{}' };
		const run = async () => json(await createCharge(ctx, project, { subscriptionId, amount: 15_000, reference: 'extra-1' }), 201);
		const first = await idempotent(db, input, run);
		expect(first.status).toBe(500);
		const retry = await idempotent(db, input, run);
		expect(retry.status).toBe(500);
		expect(retry.headers.get('idempotent-replayed')).toBe('true');
		expect(bonum.to(PURCHASE)).toHaveLength(1);
	});

	it('200: succeeded, one ledger row, charge.succeeded', async () => {
		const { bonum, run } = charge(purchaseSuccess);
		const c = await run();
		expect(c).toMatchObject({
			object: 'charge',
			status: 'succeeded',
			amount: 15_000,
			currency: 'MNT',
			reference: 'extra-1',
			subscriptionId,
			failureCode: null,
			createdAt: '2026-09-25T04:00:00.000Z'
		});
		const [call] = bonum.to(PURCHASE);
		expect(call!.body).toEqual({ amount: 15_000, currency: 'MNT', transactionId: c.id });
		expect(call!.headers.get('x-card-token')).toBe('card-token-1');
		expect(await db.select().from(ledger)).toMatchObject([{ providerRef: `charge:${c.id}`, kind: 'charge', amount: 15_000 }]);
		expect(await types()).toEqual(['charge.succeeded']);
	});

	it('400: failed as card_declined, never exposing Bonum errorCode or message', async () => {
		const { run } = charge(purchaseDeclined);
		const c = await run();
		expect(c).toMatchObject({ status: 'failed', failureCode: 'card_declined' });
		expect(JSON.stringify(c)).not.toMatch(/\(56\)|invalid\.bonum|Картаар/);
		const [e] = await db.select().from(event);
		expect(e!.type).toBe('charge.failed');
		expect(JSON.stringify(e!.data)).not.toMatch(/\(56\)|invalid\.bonum|Картаар/);
		expect(await db.select().from(ledger)).toHaveLength(0);
	});

	it('201 QUEUED: queued, then TOKEN-PAYMENT settles it', async () => {
		const { run } = charge(purchaseQueued);
		const c = await run();
		expect(c.status).toBe('queued');
		expect(await types()).toEqual([]);
		const result = await handleBonumWebhook(ctx, {
			type: 'TOKEN-PAYMENT',
			status: 'SUCCESS',
			message: '',
			body: { transactionId: c.id, completedAt: '2026-01-26 12:58:03' }
		});
		expect(result).toBe('processed');
		expect((await getCharge(ctx, project.id, c.id)).status).toBe('succeeded');
		expect(await types()).toEqual(['charge.succeeded']);
	});

	it('429 subscription.process.waiting: failed as provider_busy', async () => {
		const { run } = charge(purchaseBusy);
		expect(await run()).toMatchObject({ status: 'failed', failureCode: 'provider_busy' });
		expect(await types()).toEqual(['charge.failed']);
	});

	it('no answer: stays pending (Bonum may have charged); no event yet', async () => {
		const { run } = charge(() => {
			throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
		});
		expect(await run()).toMatchObject({ status: 'pending', failureCode: null });
		expect(await types()).toEqual([]);
	});

	it('auth failure before sending: failed as provider_unavailable', async () => {
		fakeBonum({ [AUTH_CREATE]: () => jsonResponse({}, 500), [PURCHASE]: purchaseSuccess });
		const c = await createCharge(ctx, project, { subscriptionId, amount: 100, reference: 'r' });
		expect(c).toMatchObject({ status: 'failed', failureCode: 'provider_unavailable' });
	});

	it('refuses a cancelled subscription and another project', async () => {
		charge(purchaseSuccess);
		const other = (await seedProject(db)).project;
		await expect(createCharge(ctx, other, { subscriptionId, amount: 1, reference: 'r' })).rejects.toMatchObject({ status: 404 });
		await db.update(subTable).set({ status: 'cancelled' }).where(eq(subTable.id, subscriptionId));
		await expect(createCharge(ctx, project, { subscriptionId, amount: 1, reference: 'r' })).rejects.toMatchObject({ status: 409 });
	});
});

describe('reverseCharge', () => {
	it('reverses once: a negative ledger row and charge.reversed', async () => {
		const { run } = charge(purchaseSuccess);
		const c = await run();
		const REVERSE = `DELETE /mpay-service/merchant/transaction/reverse/${c.id}`;
		const bonum = fakeBonum({ [REVERSE]: () => jsonResponse({ status: 200 }) });
		expect((await reverseCharge(ctx, project.id, c.id)).status).toBe('reversed');
		expect((await reverseCharge(ctx, project.id, c.id)).status).toBe('reversed');
		expect(bonum.count(REVERSE)).toBe(1);
		expect(bonum.to(REVERSE)[0]!.headers.get('x-card-token')).toBe('card-token-1');
		const rows = (await db.select().from(ledger)).map((l) => [l.providerRef, l.amount]).sort();
		expect(rows).toEqual([
			[`charge-reverse:${c.id}`, -15_000],
			[`charge:${c.id}`, 15_000]
		]);
		expect(await types()).toEqual(['charge.succeeded', 'charge.reversed']);
		const [row] = await db.select().from(chargeTable).where(eq(chargeTable.id, c.id));
		expect(row!.reversedAt).toBe(ctx.now);
	});

	it('refuses a failed charge and reports a Bonum refusal', async () => {
		const declined = charge(purchaseDeclined);
		const failed = await declined.run();
		await expect(reverseCharge(ctx, project.id, failed.id)).rejects.toMatchObject({ status: 409 });

		const ok = charge(purchaseSuccess);
		const c = await ok.run();
		fakeBonum({ [`DELETE /mpay-service/merchant/transaction/reverse/${c.id}`]: () => jsonResponse({}, 400) });
		await expect(reverseCharge(ctx, project.id, c.id)).rejects.toMatchObject({ status: 502, code: 'provider_error' });
		expect((await getCharge(ctx, project.id, c.id)).status).toBe('succeeded');
	});
});

describe('listCharges', () => {
	it('filters by subscription and status', async () => {
		const { run } = charge(purchaseSuccess);
		const a = await run();
		const b = await run();
		const all = await listCharges(ctx, project.id, { limit: 20, subscriptionId });
		expect(all.data.map((c) => c.id)).toEqual([b.id, a.id]);
		expect((await listCharges(ctx, project.id, { limit: 20, status: 'failed' })).data).toEqual([]);
	});
});
