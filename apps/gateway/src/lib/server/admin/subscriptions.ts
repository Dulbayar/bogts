/** Dashboard reads for subscriptions. */
import { asc, count, desc, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db';
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
import { all, eventsForSubjects, finishPage, PAGE_SIZE, scoped, type Cursor, type Page } from './common';
import { buildTimeline } from './timeline';

export const SUBSCRIPTION_TILES = ['active', 'past_due', 'pending', 'cancelled'] as const;

export type SubscriptionFilter = { projectId: string | null; status?: SubscriptionStatus | null };

export function subscriptionFilterFrom(url: URL, projectId: string | null): SubscriptionFilter {
	const s = url.searchParams.get('status');
	return {
		projectId,
		status: (SUBSCRIPTION_STATUSES as readonly string[]).includes(s ?? '') ? (s as SubscriptionStatus) : null
	};
}

export async function listSubscriptions(db: DB, f: SubscriptionFilter, cursor: Cursor = {}) {
	const rows = await db
		.select({
			id: subscription.id,
			projectId: subscription.projectId,
			projectName: project.name,
			customerRef: subscription.customerRef,
			email: subscription.email,
			status: subscription.status,
			planKey: plan.key,
			planAmount: plan.amount,
			planInterval: plan.interval,
			cardMask: card.mask,
			nextBillAt: subscription.nextBillAt,
			createdAt: subscription.createdAt
		})
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
	return finishPage(rows, cursor);
}
export type SubscriptionRow = Awaited<ReturnType<typeof listSubscriptions>> extends Page<infer R> ? R : never;

export async function subscriptionCounts(db: DB, f: SubscriptionFilter): Promise<Record<string, number>> {
	const rows = await db
		.select({ status: subscription.status, n: count() })
		.from(subscription)
		.where(scoped(subscription.projectId, f.projectId))
		.groupBy(subscription.status);
	const out: Record<string, number> = { all: 0 };
	for (const r of rows) {
		out[r.status] = r.n;
		out.all = (out.all ?? 0) + r.n;
	}
	return out;
}

export async function getSubscriptionDetail(db: DB, id: string) {
	const [row] = await db
		.select({ subscription, plan, project: { id: project.id, name: project.name } })
		.from(subscription)
		.innerJoin(plan, eq(plan.id, subscription.planId))
		.innerJoin(project, eq(project.id, subscription.projectId))
		.where(eq(subscription.id, id))
		.limit(1);
	if (!row) return null;
	const sub = row.subscription;

	// Cards this customer has had on this project, newest first (the history).
	const cards = await db
		.select()
		.from(card)
		.where(all(eq(card.projectId, sub.projectId), eq(card.customerRef, sub.customerRef)))
		.orderBy(desc(card.createdAt))
		.limit(20);
	const current = cards.find((c) => c.id === sub.cardId) ?? null;

	// Payments: renewals and the first charge are ledger rows of kind `subscription`.
	const payments = await db
		.select()
		.from(ledger)
		.where(eq(ledger.subjectId, sub.id))
		.orderBy(desc(ledger.createdAt))
		.limit(100);

	const charges = await db
		.select({ id: charge.id, amount: charge.amount, status: charge.status, reference: charge.reference, createdAt: charge.createdAt })
		.from(charge)
		.where(eq(charge.subscriptionId, sub.id))
		.orderBy(desc(charge.id))
		.limit(50);

	const events = await eventsForSubjects(db, [sub.id]);
	const timeline = await buildTimeline(db, {
		subjectType: 'subscription',
		subjectIds: [sub.id],
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

