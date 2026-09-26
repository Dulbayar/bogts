/**
 * Plan changes at the end of the paid period, on the card already saved.
 *
 * Bonum plans have a fixed amount and no endpoint changes a subscription's
 * plan, so a change is: Subscribe the same card token to the new plan with
 * `payNow: false` and a `cycleValue` that makes its first bill land on our
 * `nextBillAt`, then Delete the old Bonum subscription. Nothing is charged
 * now and nothing is prorated: the current period stays as paid, and the new
 * plan bills from the date the old one would have renewed.
 *
 * A `payNow: false` Subscribe bills on the next day whose `cycleValue`
 * matches (`firstBillDate`), so the switch can only be made once that day is
 * `nextBillAt`: at once for a longer plan (a yearly `cycleValue` is a day of
 * the year), within the last month for a monthly plan, the last week for a
 * weekly one. Until then the change waits in `nextPlanId`, and the hourly cron
 * (`applyPlanChanges`) makes it when it fits. Subscribing on the cycle day
 * itself would charge at once, so that day is never used.
 *
 * Subscribe comes first, Delete second: if Delete fails, the old Bonum
 * subscription (`retiringProviderSubscriptionId`) is deleted by the cron
 * later, well before it could bill; the customer is never left without a
 * mandate. If Bonum's answer puts the first bill on another date, the new
 * Bonum subscription is deleted again and the change stays scheduled.
 *
 * Imported from the Worker entry through `cron.ts`: relative imports only.
 */
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity, type ActivityInput } from '../activity';
import { ApiError, notFound } from '../api/errors';
import type { DB } from '../db';
import type { Config } from '../env';
import { eventInserts } from '../events/emit';
import { BonumError, bonumCall, messageKey, providerError, unwrap } from '../providers/bonum/client';
import { validatePlan } from '../providers/bonum/plans';
import { bonumTime, cycleValue, firstBillDate, ubDayStart } from '../providers/bonum/util';
import { plan as planTable, subscription as subTable, type Plan, type Subscription } from '../schema';
import { nowOf, type ServiceContext } from './context';
import { cardToken, loadCard, subscriptionEventData, subscriptionJsonOf, type SubscriptionJson } from './subscriptions';

export const ChangePlanInput = z.object({ plan: z.string().min(1).max(64) });
export type ChangePlanInput = z.output<typeof ChangePlanInput>;

/** A switch is not made this close to `nextBillAt` (Bonum bills in the early hours). */
export const PLAN_CHANGE_MIN_LEAD_MS = 6 * 60 * 60 * 1000;
/** A failed or claimed switch is tried again only this long after (the cron is hourly). */
export const PLAN_CHANGE_RETRY_MS = 55 * 60 * 1000;
/** At most this many subscriptions per cron run, for each of the two jobs. */
export const PLAN_CHANGE_BATCH = 50;

export type PlanChangeResult = 'applied' | 'waiting' | 'busy' | 'failed' | 'skipped';

const idOf = (v: unknown): string =>
	typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err);
const ubDate = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);

async function note(ctx: ServiceContext, sub: Subscription, input: Pick<ActivityInput, 'kind' | 'summary'> & { source?: ActivityInput['source'] }) {
	await recordActivity(
		ctx.db,
		{ projectId: sub.projectId, subjectType: 'subscription', subjectId: sub.id, source: input.source ?? 'provider', kind: input.kind, summary: input.summary },
		nowOf(ctx)
	);
}

async function planById(ctx: ServiceContext, id: string): Promise<Plan | null> {
	const [row] = await ctx.db.select().from(planTable).where(eq(planTable.id, id)).limit(1);
	return row ?? null;
}

/**
 * Whether a Subscribe to a plan of `interval` made at `now` would first bill on
 * `billAt`'s date (and not today, not within `PLAN_CHANGE_MIN_LEAD_MS`).
 */
export function planChangeFits(interval: Plan['interval'], billAt: number, now: number): boolean {
	if (billAt - now < PLAN_CHANGE_MIN_LEAD_MS) return false;
	return firstBillDate(interval, cycleValue(interval, billAt), now) === ubDayStart(billAt);
}

/* ------------------------------------------------------------------ *
 * API: schedule, or undo
 * ------------------------------------------------------------------ */

/**
 * `POST /v1/subscriptions/:id/plan`: the subscription moves to `plan` when
 * the paid period ends (`nextBillAt`). Asking for the plan it is on undoes a
 * scheduled change; asking again for the scheduled plan changes nothing. When
 * the switch already fits (`planChangeFits`), it is made at Bonum right away;
 * otherwise, or if Bonum fails now, the cron makes it later.
 */
export async function changePlan(ctx: ServiceContext, projectId: string, id: string, input: ChangePlanInput): Promise<SubscriptionJson> {
	const [sub] = await ctx.db
		.select()
		.from(subTable)
		.where(and(eq(subTable.id, id), eq(subTable.projectId, projectId)))
		.limit(1);
	if (!sub) throw notFound('Subscription');
	if (sub.status !== 'active' || !sub.providerSubscriptionId || sub.nextBillAt === null) {
		throw new ApiError(409, 'conflict', `The plan of a ${sub.status} subscription cannot be changed`);
	}
	const [target] = await ctx.db
		.select()
		.from(planTable)
		.where(and(eq(planTable.projectId, projectId), eq(planTable.key, input.plan)))
		.limit(1);
	if (!target) throw new ApiError(400, 'invalid_request', `plan: no plan "${input.plan}"`);
	const now = nowOf(ctx);

	if (target.id === sub.planId) {
		if (sub.nextPlanId !== null) {
			await ctx.db
				.update(subTable)
				.set({ nextPlanId: null, planChangeTriedAt: null, updatedAt: now })
				.where(eq(subTable.id, sub.id));
			await note(ctx, sub, { source: 'gateway', kind: 'subscription.plan_change.undone', summary: 'The scheduled plan change was undone' });
		}
		return subscriptionJsonOf(ctx, sub.id);
	}
	if (target.id === sub.nextPlanId) return subscriptionJsonOf(ctx, sub.id);
	if (!target.active) throw new ApiError(400, 'invalid_request', `plan: no active plan "${input.plan}"`);

	let validation;
	try {
		validation = await validatePlan(ctx, target);
	} catch (err) {
		throw providerError(err);
	}
	if (!validation.ok) throw new ApiError(409, 'plan_mismatch', validation.problems.join('; '));

	await ctx.db
		.update(subTable)
		.set({ nextPlanId: target.id, planChangeTriedAt: null, updatedAt: now })
		.where(and(eq(subTable.id, sub.id), eq(subTable.status, 'active')));
	await note(ctx, sub, {
		source: 'gateway',
		kind: 'subscription.plan_change.scheduled',
		summary: `Moves to plan ${target.key} on ${ubDate(sub.nextBillAt)}`
	});
	try {
		await applyPlanChange(ctx, sub.id);
	} catch (err) {
		// Scheduled either way: the cron tries again.
		console.error('[plan-change] immediate switch failed', errorName(err));
	}
	return subscriptionJsonOf(ctx, sub.id);
}

/* ------------------------------------------------------------------ *
 * The switch at Bonum
 * ------------------------------------------------------------------ */

/**
 * Makes the scheduled plan change of subscription `id` at Bonum if it fits
 * now. `waiting`: not yet (the cron retries); `busy`: another attempt holds
 * it, or a replaced Bonum subscription is still to delete; `failed`: Bonum
 * refused (noted on the timeline, retried after `PLAN_CHANGE_RETRY_MS`).
 */
export async function applyPlanChange(ctx: ServiceContext, id: string): Promise<PlanChangeResult> {
	const now = nowOf(ctx);
	let [sub] = await ctx.db.select().from(subTable).where(eq(subTable.id, id)).limit(1);
	if (!sub || !sub.nextPlanId || sub.status !== 'active' || !sub.providerSubscriptionId || sub.nextBillAt === null) {
		return 'skipped';
	}
	const next = await planById(ctx, sub.nextPlanId);
	const current = await planById(ctx, sub.planId);
	if (!next || !current) return 'skipped';
	const billAt = sub.nextBillAt;
	if (!planChangeFits(next.interval, billAt, now)) return 'waiting';

	// A replaced Bonum subscription must be gone first: one retiring slot.
	if (sub.retiringProviderSubscriptionId) {
		await retireReplaced(ctx, sub);
		[sub] = await ctx.db.select().from(subTable).where(eq(subTable.id, id)).limit(1);
		if (!sub || sub.retiringProviderSubscriptionId) return 'busy';
	}

	// Claim the attempt, so the API and the cron never both subscribe.
	const claimed = await ctx.db
		.update(subTable)
		.set({ planChangeTriedAt: now })
		.where(
			and(
				eq(subTable.id, id),
				eq(subTable.nextPlanId, next.id),
				eq(subTable.status, 'active'),
				or(isNull(subTable.planChangeTriedAt), lt(subTable.planChangeTriedAt, now - PLAN_CHANGE_RETRY_MS))
			)
		)
		.returning({ id: subTable.id });
	if (claimed.length !== 1) return 'busy';

	const token = await cardToken(ctx, await loadCard(ctx, sub.cardId));
	if (!token) {
		await note(ctx, sub, { kind: 'bonum.plan_change.no_card', summary: 'The plan change needs the saved card, and there is none' });
		return 'failed';
	}
	let validation;
	try {
		validation = await validatePlan(ctx, next);
	} catch (err) {
		if (!(err instanceof BonumError)) throw err;
		await note(ctx, sub, { kind: 'bonum.plan_change.failed', summary: `Bonum's plans could not be read (${err.code}); tries again` });
		return 'failed';
	}
	if (!validation.ok) {
		await note(ctx, sub, { kind: 'bonum.plan_change.plan_mismatch', summary: `Plan ${next.key} is not switched to: ${validation.problems.join('; ')}` });
		return 'failed';
	}

	const value = cycleValue(next.interval, billAt);
	let response;
	try {
		response = await bonumCall(ctx, 'subscriptions/subscribe', '/mpay-service/merchant/subscriptions/subscribe', {
			method: 'POST',
			cardToken: token,
			body: {
				planId: next.providerPlanId,
				cycleValue: value,
				cycles: null,
				payNow: false,
				...(sub.email ? { custEmail: sub.email } : {})
			}
		});
	} catch (err) {
		if (!(err instanceof BonumError)) throw err;
		await note(ctx, sub, { kind: 'bonum.plan_change.failed', summary: `Bonum could not be reached for the plan change (${err.code}); tries again` });
		return 'failed';
	}
	if (response.status < 200 || response.status >= 300) {
		await note(ctx, sub, {
			kind: 'bonum.plan_change.failed',
			summary: `Bonum refused to subscribe the card to plan ${next.key} (${messageKey(response.body) ?? `HTTP ${response.status}`}); tries again`
		});
		return 'failed';
	}
	const data = unwrap(response.body);
	const newProviderId = idOf(data.subscriptionId);
	if (!newProviderId) {
		// Bonum may have made a subscription we cannot name: a person must look.
		await note(ctx, sub, {
			kind: 'bonum.plan_change.unknown_result',
			summary: `Bonum answered the subscribe to plan ${next.key} without a subscription id; check the card's subscriptions in the Bonum merchant portal`
		});
		return 'failed';
	}
	const remoteNext = bonumTime(data.nextBillAt ?? data.nextBillingDate);
	if (remoteNext === null || ubDayStart(remoteNext) !== ubDayStart(billAt)) {
		// Bonum would bill on another date than the one the customer was promised: undo.
		const undone = await deleteAtBonum(ctx, newProviderId, next.providerPlanId, token);
		await note(ctx, sub, {
			kind: 'bonum.plan_change.date_mismatch',
			summary: undone
				? `Bonum would first bill plan ${next.key} on ${remoteNext === null ? 'an unknown date' : ubDate(remoteNext)}, not ${ubDate(billAt)}; undone, tries again`
				: `Bonum would first bill plan ${next.key} on ${remoteNext === null ? 'an unknown date' : ubDate(remoteNext)}, not ${ubDate(billAt)}, and its subscription ${newProviderId} could not be deleted; delete it in the Bonum merchant portal`
		});
		return 'failed';
	}

	const oldProviderId = sub.providerSubscriptionId;
	const [fresh] = await ctx.db.select().from(subTable).where(eq(subTable.id, id)).limit(1);
	if (!fresh || fresh.status !== 'active' || fresh.providerSubscriptionId !== oldProviderId || fresh.nextPlanId !== next.id) {
		// Cancelled or changed while Bonum answered: the new Bonum subscription is not wanted.
		await deleteAtBonum(ctx, newProviderId, next.providerPlanId, token);
		return 'skipped';
	}
	const switched: Subscription = { ...fresh, planId: next.id, providerSubscriptionId: newProviderId };
	const { statements } = eventInserts(
		ctx.db,
		{
			projectId: sub.projectId,
			type: 'subscription.plan_changed',
			subjectId: sub.id,
			data: subscriptionEventData(switched, next, { previousPlan: current.key, amount: next.amount, nextBillAt: remoteNext }),
			dedupeKey: `subscription.plan_changed:${sub.id}:${newProviderId}`
		},
		now
	);
	await ctx.db.batch([
		ctx.db
			.update(subTable)
			.set({
				planId: next.id,
				providerSubscriptionId: newProviderId,
				retiringProviderSubscriptionId: oldProviderId,
				retiringProviderPlanId: current.providerPlanId,
				nextPlanId: null,
				planChangeTriedAt: null,
				// The new plan's schedule starts at its first bill.
				nextBillAt: remoteNext,
				billingAnchor: remoteNext,
				updatedAt: now
			})
			.where(eq(subTable.id, sub.id)),
		...statements
	]);
	await note(ctx, sub, {
		kind: 'bonum.plan_change.applied',
		summary: `Moved to plan ${next.key} (Bonum subscription ${newProviderId}); first bill ${ubDate(remoteNext)}`
	});
	await retireReplaced(ctx, { ...fresh, retiringProviderSubscriptionId: oldProviderId, retiringProviderPlanId: current.providerPlanId });
	return 'applied';
}

/** Delete Subscription (`/delete`, which takes no further payment). True when it is gone (2xx or 404). */
async function deleteAtBonum(ctx: ServiceContext, providerSubscriptionId: string, providerPlanId: number, token: string | null): Promise<boolean> {
	try {
		const { status } = await bonumCall(
			ctx,
			'subscriptions/delete',
			`/mpay-service/merchant/subscriptions/${encodeURIComponent(providerSubscriptionId)}/delete`,
			{ method: 'DELETE', body: { planId: providerPlanId }, ...(token ? { cardToken: token } : {}) }
		);
		return status === 404 || (status >= 200 && status < 300);
	} catch (err) {
		if (!(err instanceof BonumError)) throw err;
		return false;
	}
}

/**
 * Deletes the Bonum subscription a plan change replaced, and forgets it once
 * it is gone. Also called by cancel, so a cancelled subscription leaves no
 * mandate behind. Returns true when nothing is left to delete.
 */
export async function retireReplaced(ctx: ServiceContext, sub: Subscription): Promise<boolean> {
	const retiring = sub.retiringProviderSubscriptionId;
	if (!retiring) return true;
	const token = await cardToken(ctx, await loadCard(ctx, sub.cardId));
	const gone = sub.retiringProviderPlanId !== null && (await deleteAtBonum(ctx, retiring, sub.retiringProviderPlanId, token));
	const now = nowOf(ctx);
	if (!gone) {
		await ctx.db.update(subTable).set({ updatedAt: now }).where(eq(subTable.id, sub.id));
		await note(ctx, sub, {
			kind: 'bonum.plan_change.retire_failed',
			summary: `The replaced Bonum subscription ${retiring} could not be deleted yet; tries again hourly`
		});
		return false;
	}
	await ctx.db
		.update(subTable)
		.set({ retiringProviderSubscriptionId: null, retiringProviderPlanId: null, updatedAt: now })
		.where(and(eq(subTable.id, sub.id), eq(subTable.retiringProviderSubscriptionId, retiring)));
	return true;
}

/* ------------------------------------------------------------------ *
 * Cron
 * ------------------------------------------------------------------ */

/**
 * Hourly (`cron.ts`): deletes replaced Bonum subscriptions still standing,
 * then makes the scheduled plan changes that now fit. Never throws for one
 * subscription's failure.
 */
export async function applyPlanChanges(db: DB, config: Config, now: number): Promise<{ retired: number; applied: number }> {
	const ctx: ServiceContext = { db, config, now };
	let retired = 0;
	let applied = 0;
	const retiring = await db
		.select()
		.from(subTable)
		.where(and(isNotNull(subTable.retiringProviderSubscriptionId), lt(subTable.updatedAt, now - PLAN_CHANGE_RETRY_MS)))
		.limit(PLAN_CHANGE_BATCH);
	for (const sub of retiring) {
		try {
			if (await retireReplaced(ctx, sub)) retired++;
		} catch (err) {
			console.error('[plan-change] retire failed', errorName(err));
		}
	}
	const due = await db
		.select({ id: subTable.id, nextBillAt: subTable.nextBillAt, interval: planTable.interval })
		.from(subTable)
		.innerJoin(planTable, eq(planTable.id, subTable.nextPlanId))
		.where(
			and(
				isNotNull(subTable.nextPlanId),
				eq(subTable.status, 'active'),
				or(isNull(subTable.planChangeTriedAt), lt(subTable.planChangeTriedAt, now - PLAN_CHANGE_RETRY_MS))
			)
		)
		.orderBy(subTable.nextBillAt)
		.limit(PLAN_CHANGE_BATCH * 4);
	let tried = 0;
	for (const row of due) {
		if (tried >= PLAN_CHANGE_BATCH) break;
		if (row.nextBillAt === null || !planChangeFits(row.interval, row.nextBillAt, now)) continue;
		tried++;
		try {
			if ((await applyPlanChange(ctx, row.id)) === 'applied') applied++;
		} catch (err) {
			console.error('[plan-change] switch failed', errorName(err));
		}
	}
	return { retired, applied };
}
