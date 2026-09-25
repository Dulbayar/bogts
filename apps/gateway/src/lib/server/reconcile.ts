/**
 * Renewal reconciliation (hourly, from `cron.ts`): the SUBSCRIPTION-PAYMENT
 * webhook is the only way Bogts hears of a renewal, and if it is lost the
 * customer is charged but loses access. So a subscription whose `nextBillAt`
 * is more than `RENEWAL_OVERDUE_MS` (6 h) in the past, with no renewal
 * credited for that period (a credited renewal moves `nextBillAt` on), is
 * looked up at Bonum: `GET /mpay-service/merchant/subscriptions` with the
 * card's `X-CARD-TOKEN`, matched by Bonum's subscription id.
 *
 * - **Billed since our last credit**: `lastBilledAt` newer than the
 *   subscription's newest ledger row, not the activation charge (within a
 *   day of the activation and over 12 h before our due date), AND Bonum's `nextBillAt` moved past our
 *   due date (a declined attempt leaves it; `lastBilledAt`/`nextBillAt` may be
 *   a date alone, read as 00:00 UB). The renewal is credited,
 *   `subscription.renewed`, for the billing period that charge pays for.
 *   The ledger row is `sub-period:<subscriptionId>:<periodKey>` with the
 *   period's `periodKey`, UNIQUE per subscription: the late real webhook for
 *   the same charge computes the same key from its `completedAt`, finds this
 *   row and adopts it instead of crediting again (`providers/bonum/webhook.ts`).
 *   If the webhook got there first, the insert collides and nothing is credited.
 *   A billed charge that cannot be credited (it fits no billing period, or
 *   its period is already credited) is held: `reconciled_at` is pushed so the
 *   subscription is asked about again only daily (`RECONCILE_HOLD_MS`), with
 *   one `reconcile.period_unknown`/`period_conflict` note a day, shown on
 *   "Needs attention".
 * - **Cancelled or unsubscribed at Bonum**: ended locally, reason
 *   `provider_cancelled`, `subscription.cancelled` (after crediting a last
 *   billed period, if there was one).
 * - **Not billed, still active**: marked `past_due` once per period with
 *   `subscription.payment_failed`, reason `renewal_missing`. Already past due:
 *   only a note, at most once a day.
 * - **Anything unclear** (Bonum error, the subscription missing from the
 *   list, an unknown status, no card token): skipped and retried next run,
 *   with at most one activity row per subscription per kind per day.
 *
 * Each run claims up to `RECONCILE_BATCH` subscriptions through
 * `reconciled_at` (a conditional update, as the sweep claims invoices), least
 * recently reconciled first, so a backlog is worked through fairly.
 *
 * Imported from the Worker entry through `cron.ts`: relative imports only.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, max, or, sql } from 'drizzle-orm';
import { recordActivity } from './activity';
import type { DB } from './db';
import type { Config } from './env';
import { eventInserts } from './events/emit';
import { newId } from './ids';
import { BonumError, bonumRequest } from './providers/bonum/client';
import { addInterval, billingPeriodKey, bonumTime, scheduledBillAt } from './providers/bonum/util';
import { activationLedgerRow, INITIAL_ECHO_MARGIN_MS, INITIAL_ECHO_WINDOW_MS, periodHolder, RECONCILED_REF_PREFIX } from './providers/bonum/webhook';
import { activity, event, ledger, plan as planTable, subscription as subTable, type Plan, type Subscription } from './schema';
import type { ServiceContext } from './services/context';
import { cardToken, endMandate, loadCard, subscriptionEventData } from './services/subscriptions';

/** A renewal is looked for once `nextBillAt` is this far in the past. */
export const RENEWAL_OVERDUE_MS = 6 * 60 * 60 * 1000;
/** At most this many subscriptions are asked about per run. */
export const RECONCILE_BATCH = 50;
/** A subscription is claimed again only this long after its last claim (the job is hourly). */
export const RECONCILE_RECLAIM_MS = 55 * 60 * 1000;
/** A repeated "still unclear" note is written at most once per this, per subscription and kind. */
export const NOTE_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * A Bonum charge (`lastBilledAt`) this close to the subscription's activation
 * is the activation (payNow) charge, never a renewal, unless it is also near
 * our due date (`INITIAL_ECHO_MARGIN_MS`): Bonum may set the first billing
 * date the day after subscribing. The same rule as the webhook's initial echo.
 */
export const ACTIVATION_CHARGE_WINDOW_MS = INITIAL_ECHO_WINDOW_MS;
/**
 * Bonum's `nextBillAt` must be more than this past our due date to count as
 * moved on (a successful charge moves it a whole interval, at least a week; a
 * declined one leaves it). The slack absorbs a date-only value or Bonum
 * billing hours off our dates.
 */
export const NEXT_BILL_MOVED_MARGIN_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * A billed charge that cannot be credited (it fits no period, or its period
 * is already held) needs a person: the subscription is asked about again only
 * this long after, not hourly.
 */
export const RECONCILE_HOLD_MS = 24 * 60 * 60 * 1000;

/** Bonum statuses that mean the mandate is over. Anything else but ACTIVE is treated as unclear. */
const ENDED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'UNSUBSCRIBED', 'DELETED']);

type Body = Record<string, unknown>;
const obj = (v: unknown): Body | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Body) : null);
const idOf = (v: unknown): string =>
	typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
const safe = (v: string) => (/^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : '?');
const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err);
const ubDate = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

export type RemoteSubscription = { status: string; lastBilledAt: number | null; nextBillAt: number | null };

/** The subscriptions array of a Get Subscriptions answer (its exact shape is undocumented). */
function listOf(body: unknown): Body[] {
	const pick = (v: unknown) => (Array.isArray(v) ? v.map(obj).filter((x): x is Body => x !== null) : null);
	const top = pick(body);
	if (top) return top;
	const b = obj(body);
	if (!b) return [];
	const data = obj(b.data);
	for (const candidate of [b.data, data?.content, data?.subscriptions, data?.items, b.content, b.subscriptions]) {
		const list = pick(candidate);
		if (list) return list;
	}
	return data && 'subscriptionId' in data ? [data] : [];
}

/** Bonum's view of one subscription, or null when its card's list does not include it. Throws BonumError. */
export async function fetchRemoteSubscription(ctx: ServiceContext, sub: Subscription, token: string): Promise<RemoteSubscription | null> {
	const body = await bonumRequest(ctx, 'subscriptions/list', '/mpay-service/merchant/subscriptions', { cardToken: token });
	const item = listOf(body).find((s) => idOf(s.subscriptionId ?? s.id) === sub.providerSubscriptionId);
	if (!item) return null;
	return {
		status: typeof item.status === 'string' ? item.status.trim().toUpperCase() : '',
		lastBilledAt: bonumTime(item.lastBilledAt),
		nextBillAt: bonumTime(item.nextBillAt ?? item.nextBillingDate)
	};
}

async function note(ctx: ServiceContext, sub: Subscription, kind: string, summary: string, opts: { daily?: boolean } = {}) {
	const now = ctx.now ?? Date.now();
	try {
		if (opts.daily) {
			const [recent] = await ctx.db
				.select({ id: activity.id })
				.from(activity)
				.where(
					and(
						eq(activity.subjectType, 'subscription'),
						eq(activity.subjectId, sub.id),
						eq(activity.kind, kind),
						gt(activity.createdAt, now - NOTE_EVERY_MS)
					)
				)
				.limit(1);
			if (recent) return;
		}
		await recordActivity(
			ctx.db,
			{ projectId: sub.projectId, subjectType: 'subscription', subjectId: sub.id, source: 'gateway', kind, summary },
			now
		);
	} catch {
		/* the timeline is best effort */
	}
}

/**
 * Credits the renewal Bonum billed but never reported. `credited`: credited
 * here. `raced`: the webhook credited this period in between. `held`: the
 * charge fits no billing period (`reconcile.period_unknown`) or its period is
 * already credited (`reconcile.period_conflict`), so it cannot be credited and
 * a person must look; the caller holds the subscription for a day.
 */
async function creditMissed(
	ctx: ServiceContext,
	sub: Subscription,
	plan: Plan,
	remote: RemoteSubscription,
	dueAt: number
): Promise<'credited' | 'raced' | 'held'> {
	const now = ctx.now ?? Date.now();
	const billedAt = remote.lastBilledAt!;
	const periodKey = billingPeriodKey(billedAt, sub.billingAnchor, plan.interval);
	const scheduled = scheduledBillAt(billedAt, sub.billingAnchor, plan.interval);
	if (!periodKey || scheduled === null) {
		await note(ctx, sub, 'reconcile.period_unknown', `Bonum shows a charge at ${ubDate(billedAt)} (UB) that fits no billing period of this subscription; not credited, rechecked daily. Check the Bonum merchant portal.`, { daily: true });
		return 'held';
	}
	if (await periodHolder(ctx, sub.id, periodKey)) {
		await note(ctx, sub, 'reconcile.period_conflict', `Bonum shows a charge at ${ubDate(billedAt)} (UB) for a period already credited, yet our next bill date did not move on; not credited, rechecked daily. Check the Bonum merchant portal.`, { daily: true });
		return 'held';
	}
	const start = Math.max(dueAt, scheduled);
	const end =
		remote.nextBillAt !== null && remote.nextBillAt > billedAt && remote.nextBillAt > start
			? remote.nextBillAt
			: addInterval(start, plan.interval, sub.billingAnchor);
	const period = { start, end };
	const ref = `${RECONCILED_REF_PREFIX}${sub.id}:${periodKey}`;
	const { statements } = eventInserts(
		ctx.db,
		{
			projectId: sub.projectId,
			type: 'subscription.renewed',
			subjectId: sub.id,
			data: subscriptionEventData(sub, plan, { amount: plan.amount, period, nextBillAt: end }),
			dedupeKey: `subscription.renewed:${ref}`
		},
		now
	);
	try {
		await ctx.db.batch([
			ctx.db.insert(ledger).values({
				id: newId(),
				projectId: sub.projectId,
				provider: 'bonum',
				providerRef: ref,
				kind: 'subscription',
				subjectId: sub.id,
				amount: plan.amount,
				periodKey,
				createdAt: now
			}),
			ctx.db
				.update(subTable)
				.set({ status: 'active', nextBillAt: end, currentPeriodStart: start, currentPeriodEnd: end, updatedAt: now })
				// Never move a subscription a concurrent webhook already moved on.
				.where(and(eq(subTable.id, sub.id), eq(subTable.nextBillAt, dueAt), inArray(subTable.status, ['active', 'past_due']))),
			...statements
		]);
	} catch (err) {
		// The webhook credited this period in between: the unique period guard held.
		if (await periodHolder(ctx, sub.id, periodKey)) return 'raced';
		throw err;
	}
	await note(
		ctx,
		sub,
		'reconcile.renewal_credited',
		`Bonum billed this subscription at ${ubDate(billedAt)} (UB) but its renewal webhook never arrived; credited ${plan.amount} MNT for the period from ${ubDate(start)}.`
	);
	return 'credited';
}

/** Not billed, still active at Bonum: past due once per period, with `subscription.payment_failed` (`renewal_missing`). */
async function markMissing(ctx: ServiceContext, sub: Subscription, plan: Plan, dueAt: number): Promise<void> {
	const now = ctx.now ?? Date.now();
	if (sub.status !== 'active') {
		await note(ctx, sub, 'reconcile.renewal_missing', `Still no renewal for the period due ${ubDate(dueAt)} (UB), and Bonum shows none billed.`, { daily: true });
		return;
	}
	const moved = await ctx.db
		.update(subTable)
		.set({ status: 'past_due', updatedAt: now })
		.where(and(eq(subTable.id, sub.id), eq(subTable.status, 'active'), eq(subTable.nextBillAt, dueAt)))
		.returning({ id: subTable.id });
	if (moved.length !== 1) return;
	const dedupeKey = `subscription.renewal_missing:${sub.id}:${dueAt}`;
	const { statements } = eventInserts(
		ctx.db,
		{
			projectId: sub.projectId,
			type: 'subscription.payment_failed',
			subjectId: sub.id,
			data: subscriptionEventData(sub, plan, { reason: 'renewal_missing', nextBillAt: dueAt }),
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
	await note(ctx, sub, 'reconcile.renewal_missing', `No renewal arrived for the period due ${ubDate(dueAt)} (UB) and Bonum shows none billed; marked past due.`);
}

/** When the subscription was activated: its first charge's ledger row, else (no amount on CARD-TOKEN) its first period's start. */
async function activatedAt(ctx: ServiceContext, sub: Subscription): Promise<number | null> {
	return (await activationLedgerRow(ctx, sub))?.createdAt ?? sub.currentPeriodStart;
}

/** Holds a subscription whose billed charge cannot be credited: asked about again only after `RECONCILE_HOLD_MS`. */
async function hold(ctx: ServiceContext, sub: Subscription, now: number): Promise<void> {
	await ctx.db
		.update(subTable)
		.set({ reconciledAt: now + RECONCILE_HOLD_MS - RECONCILE_RECLAIM_MS })
		.where(eq(subTable.id, sub.id));
}

/** When this subscription was last credited (its newest ledger row), else its current period's start. */
async function lastCredit(ctx: ServiceContext, sub: Subscription): Promise<number> {
	const [row] = await ctx.db
		.select({ at: max(ledger.createdAt) })
		.from(ledger)
		.where(and(eq(ledger.subjectId, sub.id), gt(ledger.amount, 0)));
	return row?.at ?? sub.currentPeriodStart ?? 0;
}

/** Reconciles one claimed subscription. Throws only on our own (D1) failures. */
export async function reconcileOne(ctx: ServiceContext, sub: Subscription): Promise<void> {
	const dueAt = sub.nextBillAt;
	if (dueAt === null || !sub.providerSubscriptionId) return;
	const [plan] = await ctx.db.select().from(planTable).where(eq(planTable.id, sub.planId)).limit(1);
	if (!plan) return;
	const token = await cardToken(ctx, await loadCard(ctx, sub.cardId));
	if (!token) {
		await note(ctx, sub, 'reconcile.no_card', 'Cannot ask Bonum about the missing renewal: the subscription has no saved card token.', { daily: true });
		return;
	}
	let remote: RemoteSubscription | null;
	try {
		remote = await fetchRemoteSubscription(ctx, sub, token);
	} catch (err) {
		const code = err instanceof BonumError ? safe(err.code) : errorName(err);
		await note(ctx, sub, 'reconcile.provider_error', `Could not ask Bonum about the missing renewal (${code}); retrying next hour.`, { daily: true });
		return;
	}
	if (!remote) {
		await note(ctx, sub, 'reconcile.not_found', "Bonum's list for this card does not include the subscription; retrying next hour.", { daily: true });
		return;
	}

	// Billed since we last credited this subscription, when ALL hold:
	//  - Bonum's last charge is newer than our newest credit (a late webhook or
	//    reconciliation writes its row after the charge, so the same charge
	//    never looks new);
	//  - it is not the activation charge (within a day of activation and
	//    well before our due date);
	//  - Bonum's next bill date moved past our due date: a successful charge
	//    moves the schedule on, a declined attempt (also a lastBilledAt) doesn't.
	const now = ctx.now ?? Date.now();
	const lastCreditAt = await lastCredit(ctx, sub);
	const activated = await activatedAt(ctx, sub);
	const charged =
		remote.lastBilledAt !== null &&
		remote.lastBilledAt > lastCreditAt &&
		!(
			activated !== null &&
			Math.abs(remote.lastBilledAt - activated) <= ACTIVATION_CHARGE_WINDOW_MS &&
			remote.lastBilledAt < dueAt - INITIAL_ECHO_MARGIN_MS
		);
	if (charged && remote.nextBillAt === null) {
		// A new charge, but no schedule to tell a success from a declined attempt.
		await note(ctx, sub, 'reconcile.schedule_unknown', `Bonum shows a charge at ${ubDate(remote.lastBilledAt!)} (UB) but no next bill date, so it is unclear whether it succeeded; retrying next hour.`, { daily: true });
		if (!ENDED_STATUSES.has(remote.status)) return;
	}
	const billed = charged && remote.nextBillAt !== null && remote.nextBillAt > dueAt + NEXT_BILL_MOVED_MARGIN_MS;
	if (billed && (await creditMissed(ctx, sub, plan, remote, dueAt)) === 'held' && !ENDED_STATUSES.has(remote.status)) {
		await hold(ctx, sub, now);
		return;
	}

	if (ENDED_STATUSES.has(remote.status)) {
		const [current] = await ctx.db.select().from(subTable).where(eq(subTable.id, sub.id)).limit(1);
		if (current && current.status !== 'cancelled' && (await endMandate(ctx, current, plan, 'provider_cancelled', now))) {
			await note(ctx, sub, 'reconcile.provider_cancelled', `Bonum shows the subscription ${safe(remote.status)}; its webhook never arrived. Cancelled here too.`);
		}
		return;
	}
	if (billed) return;
	if (remote.status !== 'ACTIVE') {
		await note(ctx, sub, 'reconcile.unknown_status', `Bonum reports the subscription as ${safe(remote.status || 'no status')}; left as it is, retrying next hour.`, { daily: true });
		return;
	}
	await markMissing(ctx, sub, plan, dueAt);
}

/** Claims one subscription for this run. True only for the run that set `reconciled_at`. */
async function claim(db: DB, id: string, now: number): Promise<boolean> {
	const rows = await db
		.update(subTable)
		.set({ reconciledAt: now })
		.where(and(eq(subTable.id, id), or(isNull(subTable.reconciledAt), lte(subTable.reconciledAt, now - RECONCILE_RECLAIM_MS))))
		.returning({ id: subTable.id });
	return rows.length === 1;
}

/** Looks for renewals Bonum billed but never reported. Returns how many subscriptions were asked about. Never rejects. */
export async function reconcileRenewals(db: DB, config: Config, now: number): Promise<number> {
	if (!config.providers.bonum) return 0;
	const ctx: ServiceContext = { db, config, now };
	let asked = 0;
	try {
		const due = await db
			.select()
			.from(subTable)
			.where(
				and(
					inArray(subTable.status, ['active', 'past_due']),
					isNotNull(subTable.providerSubscriptionId),
					isNotNull(subTable.nextBillAt),
					lte(subTable.nextBillAt, now - RENEWAL_OVERDUE_MS),
					or(isNull(subTable.reconciledAt), lte(subTable.reconciledAt, now - RECONCILE_RECLAIM_MS))
				)
			)
			.orderBy(asc(sql`coalesce(${subTable.reconciledAt}, 0)`), asc(subTable.nextBillAt), asc(subTable.id))
			.limit(RECONCILE_BATCH);
		for (const sub of due) {
			try {
				if (!(await claim(db, sub.id, now))) continue;
				asked++;
				await reconcileOne(ctx, sub);
			} catch (err) {
				console.error('[reconcile] subscription failed', sub.id, errorName(err));
			}
		}
	} catch (err) {
		console.error('[reconcile] failed', errorName(err));
	}
	return asked;
}
