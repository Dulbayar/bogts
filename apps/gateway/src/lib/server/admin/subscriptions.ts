/** Dashboard reads for subscriptions. */
import { asc, count, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { batchSelect, type DB } from '../db';
import {
	SUBSCRIPTION_STATUSES,
	card,
	charge,
	ledger,
	plan,
	project,
	subscription,
	type SubscriptionStatus
} from '../schema';
import { all, finishPage, PAGE_SIZE, scoped, subjectEventsFrom, subjectEventsStatements, type Cursor, type Page } from './common';
import { timelineFrom, timelineStatements } from './timeline';

export const SUBSCRIPTION_TILES = ['active', 'past_due', 'pending', 'cancelled'] as const;

export type SubscriptionFilter = { projectId: string | null; status?: SubscriptionStatus | null };

export function subscriptionFilterFrom(url: URL, projectId: string | null): SubscriptionFilter {
	const s = url.searchParams.get('status');
	return {
		projectId,
		status: (SUBSCRIPTION_STATUSES as readonly string[]).includes(s ?? '') ? (s as SubscriptionStatus) : null
	};
}

function listSubscriptionsQuery(db: DB, f: SubscriptionFilter, cursor: Cursor) {
	return db
		.select(
			batchSelect({
				id: subscription.id,
				projectId: subscription.projectId,
				projectName: project.name,
				customerRef: subscription.customerRef,
				email: subscription.email,
				status: subscription.status,
				planKey: plan.key,
				planAmount: plan.amount,
				planInterval: plan.interval,
				// Left-joined: typed nullable by hand (batchSelect keeps the column's own type).
				cardMask: sql<string | null>`${card.mask}`,
				nextBillAt: subscription.nextBillAt,
				createdAt: subscription.createdAt
			})
		)
		.from(subscription)
		.innerJoin(project, eq(project.id, subscription.projectId))
		.innerJoin(plan, eq(plan.id, subscription.planId))
		.leftJoin(card, eq(card.id, subscription.cardId))
		.where(
			all(
				scoped(subscription.projectId, f.projectId),
				f.status ? eq(subscription.status, f.status) : undefined,
				cursor.before ? lt(subscription.id, cursor.before) : undefined,
				cursor.after ? gt(subscription.id, cursor.after) : undefined
			)
		)
		.orderBy(cursor.after ? asc(subscription.id) : desc(subscription.id))
		.limit(PAGE_SIZE + 1);
}

export async function listSubscriptions(db: DB, f: SubscriptionFilter, cursor: Cursor = {}) {
	return finishPage(await listSubscriptionsQuery(db, f, cursor), cursor);
}
export type SubscriptionRow = Awaited<ReturnType<typeof listSubscriptions>> extends Page<infer R> ? R : never;

function subscriptionCountsQuery(db: DB, f: SubscriptionFilter) {
	return db
		.select(batchSelect({ status: subscription.status, n: count() }))
		.from(subscription)
		.where(scoped(subscription.projectId, f.projectId))
		.groupBy(subscription.status);
}

export async function subscriptionCounts(db: DB, f: SubscriptionFilter): Promise<Record<string, number>> {
	return subscriptionCountsFrom(await subscriptionCountsQuery(db, f));
}

/** The subscriptions list and its tiles in one round trip. */
export async function subscriptionsPage(db: DB, f: SubscriptionFilter, cursor: Cursor = {}) {
	const [rows, counts] = await db.batch([listSubscriptionsQuery(db, f, cursor), subscriptionCountsQuery(db, f)]);
	return { page: finishPage(rows, cursor), counts: subscriptionCountsFrom(counts) };
}

function subscriptionCountsFrom(rows: { status: SubscriptionStatus; n: number }[]): Record<string, number> {
	const out: Record<string, number> = { all: 0 };
	for (const r of rows) {
		out[r.status] = r.n;
		out.all = (out.all ?? 0) + r.n;
	}
	return out;
}

/** The subscription page in one round trip: everything is read by its id (the card history through subqueries). */
export async function getSubscriptionDetail(db: DB, id: string) {
	const ofSub = (column: typeof subscription.projectId | typeof subscription.customerRef) =>
		sql`(select ${sql.identifier(column.name)} from ${subscription} where ${subscription.id} = ${id})`;
	const [[row], cards, payments, charges, eventRows, deliveryRows, ...timelineRows] = await db.batch([
		db
			.select(batchSelect({ subscription, plan, project: { id: project.id, name: project.name } }))
			.from(subscription)
			.innerJoin(plan, eq(plan.id, subscription.planId))
			.innerJoin(project, eq(project.id, subscription.projectId))
			.where(eq(subscription.id, id))
			.limit(1),
		// Cards this customer has had on this project, newest first (the history).
		db
			.select()
			.from(card)
			.where(all(eq(card.projectId, ofSub(subscription.projectId)), eq(card.customerRef, ofSub(subscription.customerRef))))
			.orderBy(desc(card.createdAt))
			.limit(20),
		// Payments: renewals and the first charge are ledger rows of kind `subscription`.
		db.select().from(ledger).where(eq(ledger.subjectId, id)).orderBy(desc(ledger.createdAt)).limit(100),
		db
			.select({ id: charge.id, amount: charge.amount, status: charge.status, reference: charge.reference, createdAt: charge.createdAt })
			.from(charge)
			.where(eq(charge.subscriptionId, id))
			.orderBy(desc(charge.id))
			.limit(50),
		...subjectEventsStatements(db, [id]),
		...timelineStatements(db, 'subscription', [id])
	]);
	if (!row) return null;
	const sub = row.subscription;
	const current = cards.find((c) => c.id === sub.cardId) ?? null;

	const events = subjectEventsFrom([eventRows, deliveryRows]);
	const timeline = timelineFrom(timelineRows, {
		subjectType: 'subscription',
		events,
		extra: [{ key: 'created', at: sub.createdAt, source: 'gateway', title: 'Subscription started', detail: 'waiting for the card', href: null }]
	});

	return {
		subscription: {
			id: sub.id,
			customerRef: sub.customerRef,
			email: sub.email,
			status: sub.status,
			providerSubscriptionId: sub.providerSubscriptionId,
			currentPeriodStart: sub.currentPeriodStart,
			currentPeriodEnd: sub.currentPeriodEnd,
			nextBillAt: sub.nextBillAt,
			cancelledAt: sub.cancelledAt,
			createdAt: sub.createdAt
		},
		plan: { id: row.plan.id, key: row.plan.key, name: row.plan.name, amount: row.plan.amount, interval: row.plan.interval },
		project: row.project,
		card: current
			? { id: current.id, mask: current.mask, expiry: current.expiry, bankName: current.bankName, status: current.status }
			: null,
		cardHistory: cards.map((c) => ({
			id: c.id,
			mask: c.mask,
			status: c.status,
			current: c.id === sub.cardId,
			createdAt: c.createdAt,
			removedAt: c.removedAt
		})),
		payments: payments.map((p) => ({ id: p.id, amount: p.amount, providerRef: p.providerRef, createdAt: p.createdAt })),
		charges,
		events,
		timeline
	};
}

