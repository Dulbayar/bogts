import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt } from '../../crypto';
import { newId } from '../../ids';
import {
	activity,
	card as cardTable,
	charge as chargeTable,
	event,
	invoice as invoiceTable,
	ledger,
	subscription as subTable,
	type Plan,
	type Subscription
} from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createSubscription } from '../../services/subscriptions';
import { createTestDb, seedPlan, seedProject, TEST_ENCRYPTION_KEY, testConfig, type TestDb } from '../../testdb';
import type { Project } from '../../schema';
import { resetBonumTokenCache } from './client';
import {
	CARD_TOKEN_SUCCESS,
	docJson,
	PAYMENT_FAILED,
	PAYMENT_FAILED_CARD_ASSUMED,
	PAYMENT_SUCCESS,
	SUBSCRIPTION_PAYMENT,
	TOKEN_PAYMENT,
	UNSUBSCRIBED_ASSUMED,
	withField
} from './fixtures';
import { fakeBonum, jsonResponse } from './testing';
import { bonumTime } from './util';
import { handleBonumWebhook, WebhookRetryLater } from './webhook';

const at = (s: string) => bonumTime(s)!;

let db: TestDb;
let ctx: ServiceContext;
let project: Project;

beforeEach(async () => {
	db = createTestDb();
	ctx = { db, config: testConfig(), now: at('2026-01-26 12:59:00') };
	project = (await seedProject(db)).project;
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

const hook = (text: string) => handleBonumWebhook(ctx, JSON.parse(docJson(text)));

async function seedSub(plan: Plan, overrides: Partial<Subscription> = {}): Promise<Subscription> {
	const id = overrides.id ?? newId();
	const [row] = await db
		.insert(subTable)
		.values({
			id,
			projectId: project.id,
			planId: plan.id,
			customerRef: 'customer-1',
			email: 'a@example.com',
			status: 'pending',
			tokenizeTransactionId: id,
			returnUrl: 'https://project.test/billing',
			createdAt: ctx.now!,
			updatedAt: ctx.now!,
			...overrides
		})
		.returning();
	return row!;
}

const subRow = async (id: string) => (await db.select().from(subTable).where(eq(subTable.id, id)))[0]!;
const summaries = async (kind: string) => (await db.select().from(activity).where(eq(activity.kind, kind))).map((a) => a.summary);
const events = async () => (await db.select().from(event)).sort((a, b) => a.id.localeCompare(b.id));
const ledgerRows = async () => db.select().from(ledger);

/* ------------------------------------------------------------------ *
 * The mandate from Bonum's samples: subscription 41, plan 4 (3 MNT, monthly),
 * tokenized with transactionId 20000007, first bill 2026-01-27.
 * ------------------------------------------------------------------ */

async function plan4() {
	return seedPlan(db, project.id, { key: 'basic-monthly', providerPlanId: 4, amount: 3, interval: 'monthly' });
}

/** The CARD-TOKEN sample, retargeted at mandate 41 (decimals kept as text). */
function cardToken41(opts: { amount?: string; completedAt?: string } = {}) {
	let text = CARD_TOKEN_SUCCESS;
	text = withField(text, 'token', '"card-token-41"');
	text = withField(text, 'transactionId', '"20000007"');
	text = withField(text, 'completedAt', `"${opts.completedAt ?? '2026-01-26 09:59:11'}"`);
	text = withField(text, 'amount', opts.amount ?? '3.00');
	text = withField(text, 'subscriptionId', '41');
	text = withField(text, 'planId', '4');
	text = withField(text, 'nextBillingDate', '"2026-01-27 00:00:00"');
	return text;
}

async function activeMandate41(opts: { amount?: string } = {}) {
	const plan = await plan4();
	const sub = await seedSub(plan, { id: 'SUB41', tokenizeTransactionId: '20000007' });
	expect(await hook(cardToken41(opts))).toBe('processed');
	return { plan, sub: await subRow(sub.id) };
}

function renewal(invoiceId: number, completedAt: string, status = 'SUCCESS') {
	let text = withField(SUBSCRIPTION_PAYMENT, 'invoiceId', String(invoiceId));
	text = withField(text, 'completedAt', `"${completedAt}"`);
	return status === 'SUCCESS' ? text : withField(text, 'status', `"${status}"`);
}

/* ------------------------------------------------------------------ */

describe('CARD-TOKEN (checkout)', () => {
	it('activates from the doc sample: card saved encrypted, first charge credited once', async () => {
		// The sample: plan 1 (5.00 MNT, weekly), subscription 1, next bill 2026-02-02.
		const plan = await seedPlan(db, project.id, { key: 'weekly', providerPlanId: 1, amount: 5, interval: 'weekly' });
		const sub = await seedSub(plan, { tokenizeTransactionId: '<merchant transaction id>' });
		expect(await hook(CARD_TOKEN_SUCCESS)).toBe('processed');

		const row = await subRow(sub.id);
		expect(row).toMatchObject({
			status: 'active',
			providerSubscriptionId: '1',
			currentPeriodStart: at('2026-01-26 12:58:03'),
			currentPeriodEnd: at('2026-02-02 00:00:00'),
			nextBillAt: at('2026-02-02 00:00:00'),
			followUpLink: null
		});
		const [card] = await db.select().from(cardTable);
		expect(card).toMatchObject({ customerRef: 'customer-1', mask: '5150 23** **** 4778', expiry: '2026/11', bankName: 'Голомт банк', status: 'active' });
		expect(card!.tokenEnc).not.toContain('CARD-TOKEN');
		expect(await decrypt(card!.tokenEnc!, TEST_ENCRYPTION_KEY)).toBe('<CARD-TOKEN-VALUE>');
		expect(row.cardId).toBe(card!.id);

		expect(await ledgerRows()).toMatchObject([
			{ provider: 'bonum', providerRef: 'card-token:<merchant transaction id>', kind: 'subscription', subjectId: sub.id, amount: 5 }
		]);
		const [active] = await events();
		expect(active).toMatchObject({ type: 'subscription.active', subjectId: sub.id });
		expect(active!.data).toMatchObject({
			subscriptionId: sub.id,
			plan: 'weekly',
			customerRef: 'customer-1',
			amount: 5,
			currency: 'MNT',
			period: { start: at('2026-01-26 12:58:03'), end: at('2026-02-02 00:00:00') },
			nextBillAt: at('2026-02-02 00:00:00'),
			cardMask: '5150 23** **** 4778'
		});
		expect(JSON.stringify(active!.data)).not.toContain('CARD-TOKEN');
	});

	it('a replay changes nothing', async () => {
		const plan = await seedPlan(db, project.id, { key: 'weekly', providerPlanId: 1, amount: 5, interval: 'weekly' });
		await seedSub(plan, { tokenizeTransactionId: '<merchant transaction id>' });
		expect(await hook(CARD_TOKEN_SUCCESS)).toBe('processed');
		expect(await hook(CARD_TOKEN_SUCCESS)).toBe('duplicate');
		expect(await ledgerRows()).toHaveLength(1);
		expect(await db.select().from(cardTable)).toHaveLength(1);
		expect(await events()).toHaveLength(1);
	});

	it('a failed checkout marks the subscription failed and tells the project once', async () => {
		const plan = await plan4();
		const sub = await seedSub(plan, { tokenizeTransactionId: '20000007' });
		const failed = withField(cardToken41(), 'status', '"FAILED"');
		expect(await hook(failed)).toBe('processed');
		expect(await hook(failed)).toBe('ignored');
		expect((await subRow(sub.id)).status).toBe('failed');
		expect((await events()).map((e) => [e.type, (e.data as { reason?: string }).reason])).toEqual([
			['subscription.payment_failed', 'checkout_failed']
		]);
		expect(await ledgerRows()).toHaveLength(0);
		expect(await summaries('bonum.card_token.failed')).toEqual(['The customer did not complete card checkout']);
	});

	it('a failed checkout records the card status and bank code', async () => {
		const plan = await plan4();
		await seedSub(plan, { tokenizeTransactionId: '20000007' });
		const failed = withField(
			withField(cardToken41(), 'status', '"FAILED"'),
			'expiry',
			'"2026/11", "cardStatus":"INACTIVE", "respCode":"05"'
		);
		expect(await hook(failed)).toBe('processed');
		expect(await summaries('bonum.card_token.failed')).toEqual([
			'The customer did not complete card checkout. Bonum: INACTIVE, bank code 05 (do not honor)'
		]);
	});

	it('a late success still activates an abandoned (failed) checkout: the mandate is real', async () => {
		const plan = await plan4();
		const sub = await seedSub(plan, { tokenizeTransactionId: '20000007', status: 'failed' });
		expect(await hook(cardToken41())).toBe('processed');
		expect((await subRow(sub.id)).status).toBe('active');
	});

	it('a late success next to another live subscription activates and flags both', async () => {
		const plan = await plan4();
		const late = await seedSub(plan, { tokenizeTransactionId: '20000007', status: 'failed' });
		const live = await seedSub(plan, { status: 'active', providerSubscriptionId: '99' });
		expect(await hook(cardToken41())).toBe('processed');
		expect((await subRow(late.id)).status).toBe('active');
		const flags = (await db.select().from(activity).where(eq(activity.kind, 'bonum.duplicate_live_subscription'))).map((a) => a.subjectId);
		expect(flags.sort()).toEqual([late.id, live.id].sort());
	});
});

describe('SUBSCRIPTION-PAYMENT (renewals)', () => {
	it('credits TWO consecutive renewals with the same transactionId (bug #1 regression)', async () => {
		const { sub } = await activeMandate41();
		expect(sub.nextBillAt).toBe(at('2026-01-27 00:00:00'));

		ctx.now = at('2026-01-27 02:00:10');
		expect(await hook(SUBSCRIPTION_PAYMENT)).toBe('processed'); // the doc sample as is: invoice 786
		expect(await subRow(sub.id)).toMatchObject({
			status: 'active',
			currentPeriodStart: at('2026-01-27 00:00:00'),
			currentPeriodEnd: at('2026-02-27 00:00:00'),
			nextBillAt: at('2026-02-27 00:00:00')
		});

		ctx.now = at('2026-02-27 02:00:10');
		expect(await hook(renewal(787, '2026-02-27 02:00:05'))).toBe('processed');
		expect(await subRow(sub.id)).toMatchObject({
			currentPeriodStart: at('2026-02-27 00:00:00'),
			currentPeriodEnd: at('2026-03-27 00:00:00'),
			nextBillAt: at('2026-03-27 00:00:00')
		});

		const refs = (await ledgerRows()).map((l) => [l.providerRef, l.amount]).sort();
		expect(refs).toEqual([
			['card-token:20000007', 3],
			['sub-invoice:786', 3],
			['sub-invoice:787', 3]
		]);
		const evs = await events();
		expect(evs.map((e) => e.type)).toEqual(['subscription.active', 'subscription.renewed', 'subscription.renewed']);
		expect(evs[2]!.data).toMatchObject({
			amount: 3,
			period: { start: at('2026-02-27 00:00:00'), end: at('2026-03-27 00:00:00') },
			nextBillAt: at('2026-03-27 00:00:00')
		});
	});

	it('credits renewals charged 18 h before our nextBillAt (the echo guard is only for the first charge)', async () => {
		const plan = await plan4();
		const sub = await seedSub(plan, { id: 'SUB41', tokenizeTransactionId: '20000007' });
		// Our schedule says 18:00; Bonum actually charges at midnight.
		expect(await hook(withField(cardToken41(), 'nextBillingDate', '"2026-02-27 18:00:00"'))).toBe('processed');
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-02-27 18:00:00'));

		ctx.now = at('2026-02-27 00:00:10');
		expect(await hook(renewal(801, '2026-02-27 00:00:00'))).toBe('processed');
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-03-27 18:00:00'));
		ctx.now = at('2026-03-27 00:00:10');
		expect(await hook(renewal(802, '2026-03-27 00:00:00'))).toBe('processed');

		expect((await ledgerRows()).map((l) => l.providerRef).sort()).toEqual([
			'card-token:20000007',
			'sub-invoice:801',
			'sub-invoice:802'
		]);
		expect((await events()).filter((e) => e.type === 'subscription.renewed')).toHaveLength(2);
	});

	it('anchors monthly periods to the first billing day (Jan 31 → Feb 28 → Mar 31)', async () => {
		const plan = await plan4();
		const sub = await seedSub(plan, { id: 'SUB41', tokenizeTransactionId: '20000007' });
		ctx.now = at('2026-01-30 10:00:00');
		expect(await hook(withField(cardToken41({ completedAt: '2026-01-30 09:59:11' }), 'nextBillingDate', '"2026-01-31 00:00:00"'))).toBe('processed');

		ctx.now = at('2026-01-31 00:00:10');
		expect(await hook(renewal(901, '2026-01-31 00:00:05'))).toBe('processed');
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-02-28 00:00:00'));
		ctx.now = at('2026-02-28 00:00:10');
		expect(await hook(renewal(902, '2026-02-28 00:00:05'))).toBe('processed');
		expect(await subRow(sub.id)).toMatchObject({
			currentPeriodStart: at('2026-02-28 00:00:00'),
			nextBillAt: at('2026-03-31 00:00:00')
		});
	});

	it("prefers Bonum's nextBillingDate on a renewal when it carries one", async () => {
		const { sub } = await activeMandate41();
		ctx.now = at('2026-01-27 02:00:10');
		const text = SUBSCRIPTION_PAYMENT.replace('"currency":"MNT"', '"currency":"MNT",\n        "nextBillingDate":"2026-02-26 00:00:00"');
		expect(await hook(text)).toBe('processed');
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-02-26 00:00:00'));
	});

	it('a replayed renewal is credited once', async () => {
		await activeMandate41();
		expect(await hook(SUBSCRIPTION_PAYMENT)).toBe('processed');
		expect(await hook(SUBSCRIPTION_PAYMENT)).toBe('duplicate');
		expect((await ledgerRows()).filter((l) => l.providerRef === 'sub-invoice:786')).toHaveLength(1);
		expect((await events()).filter((e) => e.type === 'subscription.renewed')).toHaveLength(1);
	});

	it('ignores the initial payNow charge echoed as a renewal (completedAt well before nextBillAt)', async () => {
		const { sub } = await activeMandate41();
		expect(await hook(renewal(785, '2026-01-26 09:59:12'))).toBe('duplicate');
		expect((await ledgerRows()).map((l) => l.providerRef)).toEqual(['card-token:20000007']);
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-01-27 00:00:00'));
		expect((await events()).map((e) => e.type)).toEqual(['subscription.active']);
	});

	it('credits an early first charge when CARD-TOKEN carried no amount, without moving the period', async () => {
		const { sub } = await activeMandate41({ amount: '0.01' });
		expect(await ledgerRows()).toHaveLength(0);
		expect(await hook(renewal(785, '2026-01-26 09:59:12'))).toBe('processed');
		expect(await ledgerRows()).toMatchObject([{ providerRef: 'sub-invoice:785', amount: 3 }]);
		expect((await subRow(sub.id)).nextBillAt).toBe(at('2026-01-27 00:00:00'));
	});

	it('asks Bonum to retry a renewal that arrives before the activating CARD-TOKEN', async () => {
		const plan = await plan4();
		await seedSub(plan, { tokenizeTransactionId: '20000007' });
		await expect(hook(SUBSCRIPTION_PAYMENT)).rejects.toBeInstanceOf(WebhookRetryLater);
		expect(await ledgerRows()).toHaveLength(0);
	});

	it('a failed renewal records the bank code when Bonum sends one', async () => {
		await activeMandate41();
		const failed = withField(renewal(786, '2026-01-27 02:00:08', 'FAILED'), 'currency', '"MNT", "respCode":"61"');
		expect(await hook(failed)).toBe('processed');
		expect(await summaries('bonum.subscription_payment.failed')).toEqual([
			'A renewal charge failed; Bonum will retry. Bonum: bank code 61 (amount limit exceeded)'
		]);
	});

	it('a failure sets past_due once; the retried charge then succeeds', async () => {
		const { sub } = await activeMandate41();
		const failed = renewal(786, '2026-01-27 02:00:08', 'FAILED');
		expect(await hook(failed)).toBe('processed');
		expect(await hook(failed)).toBe('duplicate');
		expect((await subRow(sub.id)).status).toBe('past_due');
		expect((await events()).filter((e) => e.type === 'subscription.payment_failed')).toHaveLength(1);
		expect(await summaries('bonum.subscription_payment.failed')).toEqual(['A renewal charge failed; Bonum will retry']);

		expect(await hook(renewal(786, '2026-01-28 02:00:08'))).toBe('processed');
		expect(await subRow(sub.id)).toMatchObject({ status: 'active', nextBillAt: at('2026-02-27 00:00:00') });
		// A stale failure for the invoice that was paid changes nothing.
		expect(await hook(renewal(786, '2026-01-27 14:00:00', 'FAILED'))).toBe('duplicate');
		expect((await subRow(sub.id)).status).toBe('active');
	});

	it('ignores a renewal for another plan or without an invoice id', async () => {
		await activeMandate41();
		expect(await hook(withField(SUBSCRIPTION_PAYMENT, 'planId', '99'))).toBe('ignored');
		expect(await hook(withField(SUBSCRIPTION_PAYMENT, 'invoiceId', 'null'))).toBe('ignored');
		expect(await ledgerRows()).toHaveLength(1);
	});
});

describe('UNSUBSCRIBED', () => {
	it('cancels, drops the card token, tells the project once, and allows subscribing again', async () => {
		const { plan, sub } = await activeMandate41();
		expect(await hook(UNSUBSCRIBED_ASSUMED)).toBe('processed');
		expect(await hook(UNSUBSCRIBED_ASSUMED)).toBe('duplicate');

		expect(await subRow(sub.id)).toMatchObject({ status: 'cancelled', nextBillAt: null });
		const [card] = await db.select().from(cardTable);
		expect(card).toMatchObject({ status: 'removed', tokenEnc: null });
		const cancelled = (await events()).filter((e) => e.type === 'subscription.cancelled');
		expect(cancelled).toHaveLength(1);
		expect(cancelled[0]!.data).toMatchObject({ reason: 'retries_exhausted', customerRef: 'customer-1' });

		// Re-subscribe: the same customer and plan are no longer blocked.
		fakeBonum({
			'GET /mpay-service/merchant/values/payment-plans': () =>
				jsonResponse({ data: [{ planId: 4, name: 'Monthly Last Day Test v1', recurringType: 'MONTHLY', amount: 3, status: 'ACTIVE' }] }),
			'POST /mpay-service/merchant/cards/tokenize/request': () =>
				jsonResponse({ followUpLink: 'https://ecommerce.bonum.mn/tokenize?id=abc', id: 'abc' })
		});
		const again = await createSubscription(ctx, project, {
			plan: plan.key,
			customerRef: 'customer-1',
			returnUrl: 'https://project.test/billing'
		});
		expect(again).toMatchObject({ status: 'pending', redirectUrl: 'https://ecommerce.bonum.mn/tokenize?id=abc' });
	});
});

describe('CARD-TOKEN (card replacement)', () => {
	async function withPendingReplacement() {
		const { sub } = await activeMandate41();
		await db.update(subTable).set({ pendingTransactionId: 'RC1', followUpLink: 'https://ecommerce.bonum.mn/tokenize?id=rc' }).where(eq(subTable.id, sub.id));
		return subRow(sub.id);
	}

	function replacement(status = 'SUCCESS') {
		let text = CARD_TOKEN_SUCCESS;
		text = withField(text, 'status', `"${status}"`);
		text = withField(text, 'token', '"new-card-token"');
		text = withField(text, 'mask', '"4000 12** **** 0001"');
		text = withField(text, 'transactionId', '"RC1"');
		text = withField(text, 'amount', '0.01');
		text = withField(text, 'subscriptionId', '41');
		text = withField(text, 'planId', '4');
		return text;
	}

	it('switches to the new card; the 0.01 MNT verification is not a payment', async () => {
		const sub = await withPendingReplacement();
		const oldCardId = sub.cardId!;
		expect(await hook(replacement())).toBe('processed');

		const row = await subRow(sub.id);
		expect(row).toMatchObject({ pendingTransactionId: null, followUpLink: null, status: 'active', nextBillAt: sub.nextBillAt });
		expect(row.cardId).not.toBe(oldCardId);
		const [oldCard] = await db.select().from(cardTable).where(eq(cardTable.id, oldCardId));
		expect(oldCard).toMatchObject({ status: 'removed', tokenEnc: null });
		const [newCard] = await db.select().from(cardTable).where(eq(cardTable.id, row.cardId!));
		expect(newCard).toMatchObject({ status: 'active', mask: '4000 12** **** 0001' });
		expect(await decrypt(newCard!.tokenEnc!, TEST_ENCRYPTION_KEY)).toBe('new-card-token');

		expect((await ledgerRows()).map((l) => l.providerRef)).toEqual(['card-token:20000007']);
		const changed = (await events()).filter((e) => e.type === 'subscription.card_changed');
		expect(changed).toHaveLength(1);
		expect(changed[0]!.data).toMatchObject({ cardMask: '4000 12** **** 0001' });

		expect(await hook(replacement())).not.toBe('processed');
		expect(await db.select().from(cardTable)).toHaveLength(2);
	});

	it('a failed replacement keeps the current card', async () => {
		const sub = await withPendingReplacement();
		expect(await hook(replacement('FAILED'))).toBe('processed');
		const row = await subRow(sub.id);
		expect(row).toMatchObject({ pendingTransactionId: null, cardId: sub.cardId, status: 'active' });
		expect((await events()).map((e) => e.type)).toEqual(['subscription.active']);
	});
});

describe('PAYMENT (hosted invoice)', () => {
	async function seedInvoice(id: string, amount: number) {
		await db.insert(invoiceTable).values({
			id,
			projectId: project.id,
			provider: 'bonum',
			amount,
			reference: `order-${id}`,
			description: 'Order',
			providerInvoiceId: `bonum-${id}`,
			expiresAt: ctx.now! + 1_800_000,
			createdAt: ctx.now!,
			updatedAt: ctx.now!
		});
	}

	it('settles the doc sample with the Bonum invoiceId as the ledger ref, once', async () => {
		await seedInvoice('N998921', 10_000);
		expect(await hook(PAYMENT_SUCCESS)).toBe('processed');
		expect(await hook(PAYMENT_SUCCESS)).toBe('duplicate');
		const [inv] = await db.select().from(invoiceTable).where(eq(invoiceTable.id, 'N998921'));
		expect(inv).toMatchObject({ status: 'paid', paidAt: at('2026-01-29 11:20:33') });
		expect(await ledgerRows()).toMatchObject([{ providerRef: '8eff7d69001c03f486f64410f9daa82c', kind: 'invoice', amount: 10_000 }]);
		expect((await events()).map((e) => e.type)).toEqual(['invoice.paid']);
	});

	it('refuses a different amount', async () => {
		await seedInvoice('N998921', 9_999);
		expect(await hook(PAYMENT_SUCCESS)).toBe('ignored');
		expect(await ledgerRows()).toHaveLength(0);
	});

	it('expires the invoice from the failed sample, once', async () => {
		await seedInvoice('B347699', 15_000);
		expect(await hook(PAYMENT_FAILED)).toBe('processed');
		expect(await hook(PAYMENT_FAILED)).toBe('duplicate');
		const [inv] = await db.select().from(invoiceTable).where(eq(invoiceTable.id, 'B347699'));
		expect(inv!.status).toBe('expired');
		expect((await events()).map((e) => e.type)).toEqual(['invoice.expired']);
		expect((await summaries('bonum.payment.expired'))[0]).toBe('Bonum reported the invoice expired. Bonum: EXPIRED');
	});

	it('records the card decline codes, never the free-text message', async () => {
		await seedInvoice('B347700', 15_000);
		expect(await hook(PAYMENT_FAILED_CARD_ASSUMED)).toBe('processed');
		const [inv] = await db.select().from(invoiceTable).where(eq(invoiceTable.id, 'B347700'));
		expect(inv!.status).toBe('failed');
		expect((await events()).map((e) => e.type)).toEqual(['invoice.failed']);
		expect(await summaries('bonum.payment.failed')).toEqual([
			'Bonum reported the payment failed. Bonum: ERROR, bank code 51 (insufficient funds), card'
		]);
		const all = JSON.stringify(await db.select().from(activity)) + JSON.stringify(await events());
		expect(all).not.toContain('Үлдэгдэл');
	});

	it('records a CANCELLED invoice status', async () => {
		await seedInvoice('B347699', 15_000);
		expect(await hook(withField(PAYMENT_FAILED, 'invoiceStatus', '"CANCELLED"'))).toBe('processed');
		expect(await summaries('bonum.payment.failed')).toEqual(['Bonum reported the payment failed. Bonum: CANCELLED']);
	});

	it('ignores an unknown invoice', async () => {
		expect(await hook(PAYMENT_SUCCESS)).toBe('ignored');
	});
});

describe('TOKEN-PAYMENT (queued charge)', () => {
	async function queuedCharge() {
		const { sub } = await activeMandate41();
		const id = newId();
		await db.insert(chargeTable).values({
			id,
			projectId: project.id,
			cardId: sub.cardId!,
			subscriptionId: sub.id,
			amount: 15,
			reference: 'extra-1',
			providerTransactionId: '6ab20250512180511006',
			status: 'queued',
			createdAt: ctx.now!,
			updatedAt: ctx.now!
		});
		return id;
	}

	it('settles a queued charge once', async () => {
		const id = await queuedCharge();
		expect(await hook(TOKEN_PAYMENT)).toBe('processed');
		expect(await hook(TOKEN_PAYMENT)).toBe('duplicate');
		const [c] = await db.select().from(chargeTable).where(eq(chargeTable.id, id));
		expect(c!.status).toBe('succeeded');
		const rows = await db.select().from(ledger).where(and(eq(ledger.kind, 'charge'), eq(ledger.subjectId, id)));
		expect(rows).toMatchObject([{ providerRef: 'charge:6ab20250512180511006', amount: 15 }]);
		expect((await events()).filter((e) => e.type === 'charge.succeeded')).toHaveLength(1);
	});

	it('fails a queued charge with a safe code', async () => {
		const id = await queuedCharge();
		const failed = withField(TOKEN_PAYMENT, 'status', '"FAILED"');
		expect(await hook(failed)).toBe('processed');
		expect(await hook(failed)).toBe('duplicate');
		const [c] = await db.select().from(chargeTable).where(eq(chargeTable.id, id));
		expect(c).toMatchObject({ status: 'failed', failureCode: 'card_declined' });
		expect((await events()).filter((e) => e.type === 'charge.failed')).toHaveLength(1);
		expect(await summaries('bonum.token_payment.failed')).toEqual(['The queued card payment was declined']);
	});

	it('records the bank code of a declined queued charge', async () => {
		await queuedCharge();
		const failed = withField(
			withField(TOKEN_PAYMENT, 'status', '"FAILED"'),
			'completedAt',
			'"2026-01-26 12:58:03", "status":"FAILED", "respCode":"54", "paymentVendor":"E_COMMERCE"'
		);
		expect(await hook(failed)).toBe('processed');
		const [c] = await db.select().from(chargeTable).where(eq(chargeTable.providerTransactionId, '6ab20250512180511006'));
		expect(c!.failureCode).toBe('card_declined');
		expect(await summaries('bonum.token_payment.failed')).toEqual([
			'The queued card payment was declined. Bonum: FAILED, bank code 54 (expired card), card'
		]);
	});
});

describe('other messages', () => {
	it('ignores an unknown type and a body-less message', async () => {
		expect(await handleBonumWebhook(ctx, { type: 'SOMETHING-NEW', status: 'SUCCESS', body: {} })).toBe('ignored');
		expect(await handleBonumWebhook(ctx, { type: 'PAYMENT', status: 'SUCCESS' })).toBe('ignored');
	});
});
