/**
 * Bonum card subscriptions (mandates), provider-agnostic at the API.
 *
 * Checkout: validate our plan against Bonum's, insert a `pending` row, then
 * `cards/tokenize/request` with a subscription (`payNow: true`, `cycles: null`)
 * and hand back Bonum's follow-up link. Everything after that (activation, the
 * first charge, renewals, failures, UNSUBSCRIBED, card changes) arrives by
 * webhook (`providers/bonum/webhook.ts`); nothing here trusts the browser.
 */
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity } from '../activity';
import { ApiError, notFound } from '../api/errors';
import { decrypt } from '../crypto';
import { eventInserts, type SubscriptionEventData } from '../events/emit';
import { newId } from '../ids';
import {
	card as cardTable,
	event,
	plan as planTable,
	subscription as subTable,
	SUBSCRIPTION_STATUSES,
	type Card,
	type Plan,
	type Project,
	type Subscription
} from '../schema';
import { BonumError, bonumConfigOf, bonumCall, bonumRequest, providerError, unwrap } from '../providers/bonum/client';
import { validatePlan } from '../providers/bonum/plans';
import { bonumItem, checkedFollowUpLink, cycleValue } from '../providers/bonum/util';
import { nowOf, type ServiceContext } from './context';
import { iso, ListQuery, pageOf, type ListPage } from './paging';

/** A pending checkout older than this no longer blocks a new one (it is marked failed). */
export const PENDING_CHECKOUT_TTL_MS = 60 * 60 * 1000;

/** Where a payer returns to: https, or http on localhost for development. */
export const ReturnUrl = z
	.string()
	.max(2048)
	.refine((v) => {
		try {
			const u = new URL(v);
			const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
			return (u.protocol === 'https:' || (local && u.protocol === 'http:')) && !u.username && !u.password;
		} catch {
			return false;
		}
	}, 'must be an https:// URL');

export const CreateSubscriptionInput = z.object({
	plan: z.string().min(1).max(64),
	customerRef: z.string().min(1).max(128),
	email: z.email().max(254).optional(),
	returnUrl: ReturnUrl
});
export type CreateSubscriptionInput = z.output<typeof CreateSubscriptionInput>;

export const SubscriptionListQuery = ListQuery.extend({
	customerRef: z.string().min(1).max(128).optional(),
	status: z.enum(SUBSCRIPTION_STATUSES).optional()
});
export type SubscriptionListQuery = z.output<typeof SubscriptionListQuery>;

export type SubscriptionJson = {
	id: string;
	object: 'subscription';
	plan: string;
	customerRef: string;
	email: string | null;
	status: Subscription['status'];
	redirectUrl: string | null;
	card: { mask: string; expiry: string | null; bank: string | null } | null;
	currentPeriod: { start: string; end: string } | null;
	nextBillAt: string | null;
	cancelledAt: string | null;
	createdAt: string;
};

export function subscriptionJson(sub: Subscription, plan: Pick<Plan, 'key'>, card: Card | null | undefined): SubscriptionJson {
	const redirecting = sub.status === 'pending' || sub.pendingTransactionId !== null;
	return {
		id: sub.id,
		object: 'subscription',
		plan: plan.key,
		customerRef: sub.customerRef,
		email: sub.email,
		status: sub.status,
		redirectUrl: redirecting ? sub.followUpLink : null,
		card: card && card.status === 'active' ? { mask: card.mask, expiry: card.expiry, bank: card.bankName } : null,
		currentPeriod:
			sub.currentPeriodStart !== null && sub.currentPeriodEnd !== null
				? { start: iso(sub.currentPeriodStart)!, end: iso(sub.currentPeriodEnd)! }
				: null,
		nextBillAt: iso(sub.nextBillAt),
		cancelledAt: iso(sub.cancelledAt),
		createdAt: iso(sub.createdAt)!
	};
}

/** The `data` of a subscription event. */
export function subscriptionEventData(
	sub: Subscription,
	plan: Pick<Plan, 'key'>,
	extra: Partial<Omit<SubscriptionEventData, 'subscriptionId' | 'plan' | 'customerRef' | 'currency'>> = {}
): SubscriptionEventData {
	return { subscriptionId: sub.id, plan: plan.key, customerRef: sub.customerRef, currency: 'MNT', ...extra };
}

async function loadPlan(ctx: ServiceContext, planId: string): Promise<Plan> {
	const [row] = await ctx.db.select().from(planTable).where(eq(planTable.id, planId)).limit(1);
	if (!row) throw new Error('subscription plan row missing');
	return row;
}

export async function loadCard(ctx: ServiceContext, cardId: string | null): Promise<Card | null> {
	if (!cardId) return null;
	const [row] = await ctx.db.select().from(cardTable).where(eq(cardTable.id, cardId)).limit(1);
	return row ?? null;
}

/** The decrypted card token of an active card, or null. Never log it. */
export async function cardToken(ctx: ServiceContext, card: Card | null): Promise<string | null> {
	if (!card || card.status !== 'active' || !card.tokenEnc) return null;
	return decrypt(card.tokenEnc, ctx.config.encryptionKey);
}

async function loadOwned(ctx: ServiceContext, projectId: string, id: string): Promise<Subscription> {
	const [row] = await ctx.db
		.select()
		.from(subTable)
		.where(and(eq(subTable.id, id), eq(subTable.projectId, projectId)))
		.limit(1);
	if (!row) throw notFound('Subscription');
	return row;
}

async function toJson(ctx: ServiceContext, sub: Subscription): Promise<SubscriptionJson> {
	const [plan, card] = await Promise.all([loadPlan(ctx, sub.planId), loadCard(ctx, sub.cardId)]);
	return subscriptionJson(sub, plan, card);
}

async function reload(ctx: ServiceContext, id: string): Promise<Subscription> {
	const [row] = await ctx.db.select().from(subTable).where(eq(subTable.id, id)).limit(1);
	if (!row) throw notFound('Subscription');
	return row;
}

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

export async function createSubscription(
	ctx: ServiceContext,
	project: Project,
	input: CreateSubscriptionInput
): Promise<SubscriptionJson> {
	bonumConfigOf(ctx);
	const now = nowOf(ctx);
	const [plan] = await ctx.db
		.select()
		.from(planTable)
		.where(and(eq(planTable.projectId, project.id), eq(planTable.key, input.plan)))
		.limit(1);
	if (!plan || !plan.active) throw new ApiError(400, 'invalid_request', `plan: no active plan "${input.plan}"`);

	// One live mandate per customer and plan. Cancelled, failed (and UNSUBSCRIBED)
	// ones never block, so a customer can always subscribe again.
	const live = await ctx.db
		.select()
		.from(subTable)
		.where(
			and(
				eq(subTable.projectId, project.id),
				eq(subTable.customerRef, input.customerRef),
				eq(subTable.planId, plan.id),
				inArray(subTable.status, ['pending', 'active', 'past_due'])
			)
		);
	for (const existing of live) {
		if (existing.status === 'pending' && existing.createdAt <= now - PENDING_CHECKOUT_TTL_MS) {
			// Abandoned checkout. If Bonum's CARD-TOKEN still arrives, the webhook activates it.
			await ctx.db
				.update(subTable)
				.set({ status: 'failed', updatedAt: now })
				.where(and(eq(subTable.id, existing.id), eq(subTable.status, 'pending')));
			continue;
		}
		throw new ApiError(
			409,
			'conflict',
			existing.status === 'pending'
				? `Subscription ${existing.id} for this customer and plan is waiting for checkout`
				: `Subscription ${existing.id} for this customer and plan is already ${existing.status}`
		);
	}

	let validation;
	try {
		validation = await validatePlan(ctx, plan);
	} catch (err) {
		throw providerError(err);
	}
	if (!validation.ok) throw new ApiError(409, 'plan_mismatch', validation.problems.join('; '));

	const id = newId();
	const inserted: Subscription = {
		id,
		projectId: project.id,
		planId: plan.id,
		customerRef: input.customerRef,
		email: input.email ?? null,
		status: 'pending',
		providerSubscriptionId: null,
		// Bonum repeats this on every renewal; it identifies the mandate, never a payment.
		tokenizeTransactionId: id,
		pendingTransactionId: null,
		followUpLink: null,
		cardId: null,
		currentPeriodStart: null,
		currentPeriodEnd: null,
		nextBillAt: null,
		billingAnchor: null,
		reconciledAt: null,
		cancelledAt: null,
		returnUrl: input.returnUrl,
		createdAt: now,
		updatedAt: now
	};
	await ctx.db.insert(subTable).values(inserted);

	let followUpLink: string;
	try {
		const body = await bonumRequest(ctx, 'cards/tokenize', '/mpay-service/merchant/cards/tokenize/request', {
			method: 'POST',
			body: {
				callback: `${ctx.config.publicOrigin}/return/s/${id}`,
				transactionId: id,
				subscription: {
					planId: plan.providerPlanId,
					cycleValue: String(cycleValue(plan.interval, now)),
					cycles: null,
					payNow: true,
					...(input.email ? { custEmail: input.email } : {})
				},
				items: [bonumItem(plan.name, plan.amount, { image: true })]
			}
		});
		followUpLink = checkedFollowUpLink(unwrap(body).followUpLink, 'cards/tokenize');
	} catch (err) {
		await checkoutRefused(ctx, { ...inserted }, plan);
		if (err instanceof BonumError) {
			await recordActivity(ctx.db, {
				projectId: project.id,
				subjectType: 'subscription',
				subjectId: id,
				source: 'provider',
				kind: 'bonum.tokenize.failed',
				summary: `Bonum refused the checkout (${err.code})`
			});
		}
		throw providerError(err);
	}
	await ctx.db.update(subTable).set({ followUpLink, updatedAt: now }).where(eq(subTable.id, id));
	return subscriptionJson({ ...inserted, followUpLink }, plan, null);
}

/**
 * Bonum refused the checkout request itself: the subscription ends `failed`
 * and the project hears `subscription.payment_failed` (`checkout_failed`),
 * as it would for an invoice (`invoice.failed`). The dedupe key is the one a
 * failed CARD-TOKEN for this checkout would use, so it is emitted once.
 */
async function checkoutRefused(ctx: ServiceContext, sub: Subscription, plan: Plan): Promise<void> {
	const now = nowOf(ctx);
	const ended = await ctx.db
		.update(subTable)
		.set({ status: 'failed', updatedAt: now })
		.where(and(eq(subTable.id, sub.id), eq(subTable.status, 'pending')))
		.returning({ id: subTable.id });
	if (ended.length !== 1) return;
	const dedupeKey = `subscription.checkout_failed:${sub.id}:${sub.tokenizeTransactionId}`;
	const { statements } = eventInserts(
		ctx.db,
		{
			projectId: sub.projectId,
			type: 'subscription.payment_failed',
			subjectId: sub.id,
			data: subscriptionEventData(sub, plan, { reason: 'checkout_failed', nextBillAt: null }),
			dedupeKey
		},
		now
	);
	try {
		await ctx.db.batch(statements);
	} catch (err) {
		const [existing] = await ctx.db.select({ id: event.id }).from(event).where(eq(event.dedupeKey, dedupeKey)).limit(1);
		if (!existing) throw err;
	}
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

export async function getSubscription(ctx: ServiceContext, projectId: string, id: string): Promise<SubscriptionJson> {
	return toJson(ctx, await loadOwned(ctx, projectId, id));
}

export async function listSubscriptions(
	ctx: ServiceContext,
	projectId: string,
	q: SubscriptionListQuery
): Promise<ListPage<SubscriptionJson>> {
	const where: SQL[] = [eq(subTable.projectId, projectId)];
	if (q.cursor) where.push(lt(subTable.id, q.cursor));
	if (q.customerRef) where.push(eq(subTable.customerRef, q.customerRef));
	if (q.status) where.push(eq(subTable.status, q.status));
	const rows = await ctx.db
		.select({ sub: subTable, plan: { key: planTable.key }, card: cardTable })
		.from(subTable)
		.innerJoin(planTable, eq(planTable.id, subTable.planId))
		.leftJoin(cardTable, eq(cardTable.id, subTable.cardId))
		.where(and(...where))
		.orderBy(desc(subTable.id))
		.limit(q.limit + 1);
	return pageOf(
		rows.map((r) => ({ id: r.sub.id, ...r })),
		q.limit,
		(r) => subscriptionJson(r.sub, r.plan, r.card)
	);
}

/* ------------------------------------------------------------------ *
 * Cancel
 * ------------------------------------------------------------------ */

/**
 * Ends the mandate at Bonum (`DELETE /subscriptions/:id/delete` with `planId`,
 * which, unlike plain unsubscribe, creates no further payment), then locally:
 * cancelled, card token dropped, one `subscription.cancelled` event. A 404 from
 * Bonum means it is already gone. Cancelling a cancelled subscription is a no-op.
 * With no Bonum subscription id it refuses (409): cancel it in Bonum's portal.
 * `actor` (e.g. `actorOf(admin)`) marks a dashboard cancel: reason `cancelled_by_admin`.
 */
export async function cancelSubscription(
	ctx: ServiceContext,
	projectId: string,
	id: string,
	actor?: string
): Promise<SubscriptionJson> {
	const sub = await loadOwned(ctx, projectId, id);
	if (sub.status === 'cancelled') return toJson(ctx, sub);
	if (sub.status !== 'active' && sub.status !== 'past_due') {
		throw new ApiError(409, 'conflict', `A ${sub.status} subscription cannot be cancelled`);
	}
	if (!sub.providerSubscriptionId) {
		// Cancelling only here would leave Bonum charging the card.
		throw new ApiError(
			409,
			'conflict',
			'This subscription has no Bonum subscription id; cancel it in the Bonum merchant portal.'
		);
	}
	const plan = await loadPlan(ctx, sub.planId);
	const card = await loadCard(ctx, sub.cardId);

	const token = await cardToken(ctx, card);
	let status: number;
	try {
		({ status } = await bonumCall(
			ctx,
			'subscriptions/delete',
			`/mpay-service/merchant/subscriptions/${encodeURIComponent(sub.providerSubscriptionId)}/delete`,
			{ method: 'DELETE', body: { planId: plan.providerPlanId }, ...(token ? { cardToken: token } : {}) }
		));
	} catch (err) {
		throw providerError(err);
	}
	if (status !== 404 && (status < 200 || status >= 300)) {
		await recordActivity(ctx.db, {
			projectId,
			subjectType: 'subscription',
			subjectId: sub.id,
			source: 'provider',
			kind: 'bonum.subscription_delete.failed',
			summary: `Bonum refused to delete the subscription (HTTP ${status})`
		});
		throw new ApiError(502, 'provider_error', 'Bonum did not cancel the subscription. Try again.');
	}

	const now = nowOf(ctx);
	const reason = actor ? 'cancelled_by_admin' : 'cancelled_by_project';
	await endMandate(ctx, sub, plan, reason, now);
	await recordActivity(
		ctx.db,
		{
			projectId,
			subjectType: 'subscription',
			subjectId: sub.id,
			source: actor ? 'admin' : 'gateway',
			kind: actor ? 'admin.subscription.cancel' : 'subscription.cancel',
			summary: actor ? 'Cancelled from the dashboard' : 'Cancelled by the project'
		},
		now
	);
	return toJson(ctx, await reload(ctx, sub.id));
}

/**
 * Marks a mandate cancelled, drops its card token and emits
 * `subscription.cancelled` once (dedupe key per subscription), all in one batch.
 * Returns false when it was already cancelled.
 */
export async function endMandate(
	ctx: ServiceContext,
	sub: Subscription,
	plan: Plan,
	reason: string,
	now: number
): Promise<boolean> {
	const dedupeKey = `subscription.cancelled:${sub.id}`;
	const { statements } = eventInserts(
		ctx.db,
		{
			projectId: sub.projectId,
			type: 'subscription.cancelled',
			subjectId: sub.id,
			data: subscriptionEventData(sub, plan, { reason, nextBillAt: null }),
			dedupeKey
		},
		now
	);
	const cardUpdate = sub.cardId
		? [
				ctx.db
					.update(cardTable)
					.set({ status: 'removed', tokenEnc: null, removedAt: now, updatedAt: now })
					.where(and(eq(cardTable.id, sub.cardId), eq(cardTable.status, 'active')))
			]
		: [];
	try {
		await ctx.db.batch([
			ctx.db
				.update(subTable)
				.set({
					status: 'cancelled',
					cancelledAt: now,
					nextBillAt: null,
					pendingTransactionId: null,
					followUpLink: null,
					updatedAt: now
				})
				.where(eq(subTable.id, sub.id)),
			...cardUpdate,
			...statements
		]);
		return true;
	} catch (err) {
		const [existing] = await ctx.db.select({ id: event.id }).from(event).where(eq(event.dedupeKey, dedupeKey)).limit(1);
		if (existing) return false;
		throw err;
	}
}

/* ------------------------------------------------------------------ *
 * Card replacement
 * ------------------------------------------------------------------ */

/**
 * Starts a card change (`PUT /subscriptions/:id/change/create-new-token`) and
 * returns the subscription with `redirectUrl` set to Bonum's page. The switch
 * happens only when the CARD-TOKEN webhook for the new `transactionId` arrives;
 * a failed attempt leaves the current card in place.
 */
export async function replaceCard(ctx: ServiceContext, projectId: string, id: string): Promise<SubscriptionJson> {
	bonumConfigOf(ctx);
	const sub = await loadOwned(ctx, projectId, id);
	if ((sub.status !== 'active' && sub.status !== 'past_due') || !sub.providerSubscriptionId) {
		throw new ApiError(409, 'conflict', `The card of a ${sub.status} subscription cannot be changed`);
	}
	const card = await loadCard(ctx, sub.cardId);
	const token = await cardToken(ctx, card);
	const txn = newId();
	let followUpLink: string;
	try {
		const body = await bonumRequest(
			ctx,
			'subscriptions/change',
			`/mpay-service/merchant/subscriptions/${encodeURIComponent(sub.providerSubscriptionId)}/change/create-new-token`,
			{
				method: 'PUT',
				body: { callback: `${ctx.config.publicOrigin}/return/s/${sub.id}`, transactionId: txn },
				...(token ? { cardToken: token } : {})
			}
		);
		followUpLink = checkedFollowUpLink(unwrap(body).followUpLink, 'subscriptions/change');
	} catch (err) {
		throw providerError(err);
	}
	const now = nowOf(ctx);
	await ctx.db
		.update(subTable)
		.set({ pendingTransactionId: txn, followUpLink, updatedAt: now })
		.where(eq(subTable.id, sub.id));
	return toJson(ctx, await reload(ctx, sub.id));
}
