/**
 * The Overview page: what needs attention, the period's KPIs, daily volume,
 * recent events and delivery health. Every number comes from the ledger, the
 * outbox or current state; nothing is estimated.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, max, sql } from 'drizzle-orm';
import type { DB } from '../db';
import type { Config } from '../env';
import { activity, charge, delivery, event, invoice, ledger, plan, project, subscription } from '../schema';
import { formatMoney, ubDayStart } from '$lib/format';
import { all, latestDeliveryJoin, scoped, summarizeDelivery } from './common';
import { failingCond, subjectHref } from './events';
import { deploymentMode } from './health';
import { deliveryHealth, planChecks } from './projects';

const DAY = 86_400_000;
export const PERIODS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type Period = keyof typeof PERIODS;

/** Rates and deltas are shown only above this many finished payments (no percentages on tiny bases). */
export const MIN_RATE_BASE = 20;

/** Attention rows listed one by one before they are summarised. */
const STUCK_LIMIT = 5;

/** Money-moved-twice items stay on "Needs attention" this long after the last sighting (there is no "resolved" state). */
export const PAID_TWICE_WINDOW_MS = 30 * DAY;

export function periodFrom(url: URL): Period {
	const p = url.searchParams.get('period');
	return p === '7d' || p === '90d' ? p : '30d';
}

const subs = (n: number) => (n === 1 ? 'subscription' : 'subscriptions');

/** Activity kinds that go on "Needs attention": one line each, with how many subjects. */
const ACTIVITY_FLAGS: {
	subject: 'invoice' | 'subscription';
	kinds: string[];
	tone: AttentionItem['tone'];
	text: (n: number) => string;
}[] = [
	{
		subject: 'invoice',
		kinds: ['qpay.payment_refunded'],
		tone: 'warning',
		text: (n) => `**${n}** paid QPay ${n === 1 ? 'invoice shows its payment' : 'invoices show their payment'} refunded`
	},
	{
		subject: 'subscription',
		kinds: ['bonum.subscription_payment.same_period'],
		tone: 'danger',
		text: (n) => `**${n}** ${subs(n)} charged twice for one period: refund one`
	},
	{
		subject: 'subscription',
		kinds: ['reconcile.period_conflict', 'reconcile.period_unknown'],
		tone: 'danger',
		text: (n) => `**${n}** ${subs(n)} with a Bonum charge that couldn't be credited: check Bonum`
	},
	{
		subject: 'subscription',
		kinds: ['reconcile.renewal_missing'],
		tone: 'warning',
		text: (n) => `**${n}** ${subs(n)} missing a renewal at Bonum`
	},
	{
		subject: 'subscription',
		kinds: ['reconcile.no_card'],
		tone: 'warning',
		text: (n) => `**${n}** ${subs(n)} can't be reconciled: no saved card`
	},
	{
		subject: 'subscription',
		kinds: ['reconcile.provider_cancelled'],
		tone: 'warning',
		text: (n) => `**${n}** ${subs(n)} cancelled at Bonum without a webhook`
	}
];

export type AttentionItem = {
	tone: 'danger' | 'warning';
	text: string;
	/** Bold parts of `text` are marked with **…** */
	href: string | null;
};

async function attention(db: DB, config: Config, projectId: string | null, now: number): Promise<AttentionItem[]> {
	const items: AttentionItem[] = [];
	const scopeQ = projectId ? `&project=${projectId}` : '';

	// Failing deliveries, per project: the same rows as the events list's `?status=failing`.
	const failing = await db
		.select({ projectId: event.projectId, name: project.name, n: count() })
		.from(event)
		.innerJoin(delivery, latestDeliveryJoin)
		.innerJoin(project, eq(project.id, event.projectId))
		.where(all(failingCond(now), scoped(event.projectId, projectId)))
		.groupBy(event.projectId, project.name);
	for (const f of failing) {
		items.push({
			tone: 'danger',
			text: `**${f.n}** webhook ${f.n === 1 ? 'delivery is' : 'deliveries are'} failing for **${f.name}**`,
			href: `/admin/events?status=failing&project=${f.projectId}`
		});
	}

	// Past-due subscriptions.
	const [pastDue] = await db
		.select({ n: count() })
		.from(subscription)
		.where(all(eq(subscription.status, 'past_due'), scoped(subscription.projectId, projectId)));
	if (pastDue && pastDue.n > 0) {
		items.push({
			tone: 'warning',
			text: `**${pastDue.n}** ${pastDue.n === 1 ? 'subscription has' : 'subscriptions have'} a failed payment`,
			href: `/admin/subscriptions?status=past_due${scopeQ}`
		});
	}

	// Charges with no outcome an hour on: Bonum has no production status API, and the money may have moved.
	const stuck = await db
		.select({ id: charge.id, amount: charge.amount, reference: charge.reference })
		.from(charge)
		.where(all(eq(charge.status, 'pending'), lt(charge.createdAt, now - 3600_000), scoped(charge.projectId, projectId)))
		.orderBy(charge.createdAt)
		.limit(STUCK_LIMIT + 1);
	for (const c of stuck.slice(0, STUCK_LIMIT)) {
		items.push({
			tone: 'danger',
			text: `Charge **${formatMoney(c.amount)}** (\`${c.reference}\`) has no result after an hour: check the Bonum merchant portal`,
			href: `/admin/charges/${c.id}`
		});
	}
	if (stuck.length > STUCK_LIMIT) {
		items.push({ tone: 'danger', text: 'More charges have no result after an hour', href: `/admin/charges?status=pending${scopeQ}` });
	}

	// Two live Bonum mandates for the same customer and plan (reported by the Bonum module).
	const dupes = await db
		.selectDistinct({ id: subscription.id, customerRef: subscription.customerRef })
		.from(activity)
		.innerJoin(subscription, eq(subscription.id, activity.subjectId))
		.where(
			all(
				eq(activity.subjectType, 'subscription'),
				eq(activity.kind, 'bonum.duplicate_live_subscription'),
				inArray(subscription.status, ['active', 'past_due']),
				scoped(subscription.projectId, projectId)
			)
		)
		.limit(STUCK_LIMIT);
	for (const d of dupes) {
		items.push({
			tone: 'danger',
			text: `**${d.customerRef}** has two live Bonum subscriptions for the same plan`,
			href: `/admin/subscriptions/${d.id}`
		});
	}

	// One purchase (project + reference) paid by two invoices: refund one.
	const twice = await db
		.select({ projectId: invoice.projectId, reference: invoice.reference, last: max(activity.createdAt) })
		.from(activity)
		.innerJoin(invoice, eq(invoice.id, activity.subjectId))
		.where(
			all(
				eq(activity.subjectType, 'invoice'),
				eq(activity.kind, 'invoice.duplicate_payment'),
				gte(activity.createdAt, now - PAID_TWICE_WINDOW_MS),
				scoped(invoice.projectId, projectId)
			)
		)
		.groupBy(invoice.projectId, invoice.reference)
		.orderBy(desc(max(activity.createdAt)));
	const newestTwice = twice[0];
	if (newestTwice) {
		items.push({
			tone: 'danger',
			text: `**${twice.length}** ${twice.length === 1 ? 'reference' : 'references'} paid twice: refund one`,
			href: `/admin/payments?reference=${encodeURIComponent(newestTwice.reference)}&project=${newestTwice.projectId}`
		});
	}

	// One QPay invoice that payment/check shows paid more than once.
	const extra = await db
		.select({ id: invoice.id })
		.from(activity)
		.innerJoin(invoice, eq(invoice.id, activity.subjectId))
		.where(
			all(
				eq(activity.subjectType, 'invoice'),
				eq(activity.kind, 'qpay.extra_payment'),
				gte(activity.createdAt, now - PAID_TWICE_WINDOW_MS),
				scoped(invoice.projectId, projectId)
			)
		)
		.groupBy(invoice.id)
		.orderBy(desc(max(activity.createdAt)));
	if (extra.length) {
		items.push({
			tone: 'danger',
			text: `**${extra.length}** QPay ${extra.length === 1 ? 'invoice was' : 'invoices were'} paid more than once: refund the extra payment`,
			href: extra.length === 1 ? `/admin/payments/${extra[0]!.id}` : `/admin/payments?provider=qpay&status=paid${scopeQ}`
		});
	}

	// Findings recorded as activity (last 30 days), one line per kind with a count,
	// linking to the newest subject.
	for (const f of ACTIVITY_FLAGS) {
		const subject = f.subject === 'invoice' ? invoice : subscription;
		const rows = await db
			.select({ id: subject.id })
			.from(activity)
			.innerJoin(subject, eq(subject.id, activity.subjectId))
			.where(
				all(
					eq(activity.subjectType, f.subject),
					inArray(activity.kind, f.kinds),
					gte(activity.createdAt, now - PAID_TWICE_WINDOW_MS),
					scoped(subject.projectId, projectId)
				)
			)
			.groupBy(subject.id)
			.orderBy(desc(max(activity.createdAt)));
		const newest = rows[0];
		if (!newest) continue;
		items.push({
			tone: f.tone,
			text: f.text(rows.length),
			href: f.subject === 'invoice' ? `/admin/payments/${newest.id}` : `/admin/subscriptions/${newest.id}`
		});
	}

	// Plans that don't match Bonum (archived projects' plans are not in use).
	const live = db.select({ id: project.id }).from(project).where(isNull(project.archivedAt));
	const plans = await db
		.select()
		.from(plan)
		.where(all(eq(plan.active, true), inArray(plan.projectId, live), scoped(plan.projectId, projectId)));
	const checks = await planChecks(db, plans);
	const mismatched = plans.filter((p) => checks.get(p.id)?.status === 'mismatch');
	if (mismatched.length) {
		const first = mismatched[0]!;
		items.push({
			tone: 'danger',
			text:
				mismatched.length === 1
					? `**1** plan doesn't match Bonum (\`${first.key}\`)`
					: `**${mismatched.length}** plans don't match Bonum`,
			href: `/admin/projects/${first.projectId}?tab=plans`
		});
	}

	// Projects without a webhook URL.
	const noHook = await db
		.select({ id: project.id, name: project.name })
		.from(project)
		.where(all(isNull(project.webhookUrl), isNull(project.archivedAt), projectId ? eq(project.id, projectId) : undefined));
	for (const p of noHook) {
		items.push({
			tone: 'warning',
			text: `**${p.name}** has no webhook URL: events are stored but not sent`,
			href: `/admin/projects/${p.id}?tab=webhook`
		});
	}

	// A provider that is used but not configured.
	if (!config.providers.qpay) {
		const [used] = await db
			.select({ n: count() })
			.from(invoice)
			.where(all(eq(invoice.provider, 'qpay'), scoped(invoice.projectId, projectId)));
		if (used && used.n > 0) items.push({ tone: 'warning', text: '**QPay** is not configured', href: '/admin/settings' });
	}
	if (!config.providers.bonum && plans.length > 0) {
		items.push({ tone: 'warning', text: '**Bonum** is not configured', href: '/admin/settings' });
	}

	const mode = deploymentMode(config);
	if (mode.mode === 'mixed') {
		items.push({
			tone: 'warning',
			text: `**Sandbox**: ${mode.sandbox.join(' and ')} ${mode.sandbox.length === 1 ? 'is' : 'are'} using test credentials`,
			href: '/admin/settings'
		});
	}
	return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'danger' ? -1 : 1));
}

/** The period as whole Ulaanbaatar calendar days ending today: the chart's bars, [start, end). */
export function periodWindow(days: number, now: number): { start: number; end: number } {
	const start = ubDayStart(now) - (days - 1) * DAY;
	return { start, end: start + days * DAY };
}

async function kpis(db: DB, projectId: string | null, days: number, now: number) {
	const { start, end } = periodWindow(days, now);
	const prevStart = start - days * DAY;
	const ledgerSum = async (from: number, to: number) => {
		const [r] = await db
			.select({
				volume: sql<number>`coalesce(sum(${ledger.amount}), 0)`,
				payments: sql<number>`coalesce(sum(case when ${ledger.amount} > 0 then 1 else 0 end), 0)`
			})
			.from(ledger)
			.where(all(gte(ledger.createdAt, from), lt(ledger.createdAt, to), scoped(ledger.projectId, projectId)));
		return { volume: Number(r?.volume ?? 0), payments: Number(r?.payments ?? 0) };
	};
	const [cur, prev] = await Promise.all([ledgerSum(start, end), ledgerSum(prevStart, start)]);

	// Success rate over finished invoices and charges created in the period.
	const inv = await db
		.select({ status: invoice.status, n: count() })
		.from(invoice)
		.where(all(gte(invoice.createdAt, start), lt(invoice.createdAt, end), inArray(invoice.status, ['paid', 'failed', 'expired']), scoped(invoice.projectId, projectId)))
		.groupBy(invoice.status);
	const chg = await db
		.select({ status: charge.status, n: count() })
		.from(charge)
		.where(all(gte(charge.createdAt, start), lt(charge.createdAt, end), inArray(charge.status, ['succeeded', 'failed', 'reversed']), scoped(charge.projectId, projectId)))
		.groupBy(charge.status);
	let good = 0;
	let finished = 0;
	for (const r of inv) {
		finished += r.n;
		if (r.status === 'paid') good += r.n;
	}
	for (const r of chg) {
		finished += r.n;
		if (r.status !== 'failed') good += r.n;
	}

	const [active] = await db
		.select({ n: count() })
		.from(subscription)
		.where(all(eq(subscription.status, 'active'), scoped(subscription.projectId, projectId)));
	const [started] = await db
		.select({ n: count() })
		.from(subscription)
		.where(
			all(gte(subscription.createdAt, start), lt(subscription.createdAt, end), inArray(subscription.status, ['active', 'past_due', 'cancelled']), scoped(subscription.projectId, projectId))
		);
	const [ended] = await db
		.select({ n: count() })
		.from(subscription)
		.where(all(isNotNull(subscription.cancelledAt), gte(subscription.cancelledAt, start), lt(subscription.cancelledAt, end), scoped(subscription.projectId, projectId)));

	return {
		volume: cur.volume,
		payments: cur.payments,
		/** null when the previous period had too few payments to compare */
		volumeDelta: prev.payments >= MIN_RATE_BASE && prev.volume > 0 ? (cur.volume - prev.volume) / prev.volume : null,
		successRate: finished >= MIN_RATE_BASE ? good / finished : null,
		finished,
		activeSubscriptions: active?.n ?? 0,
		subscriptionsStarted: started?.n ?? 0,
		subscriptionsEnded: ended?.n ?? 0
	};
}

/** Daily net volume and payment count, UB days, oldest first, one entry per day (zeros included). */
async function dailyVolume(db: DB, projectId: string | null, days: number, now: number) {
	const { start: firstDay, end } = periodWindow(days, now);
	const offset = 8 * 3600_000;
	const rows = await db
		.select({
			day: sql<number>`((${ledger.createdAt} + ${sql.raw(String(offset))}) / ${sql.raw(String(DAY))}) * ${sql.raw(String(DAY))} - ${sql.raw(String(offset))}`,
			volume: sql<number>`sum(${ledger.amount})`,
			n: sql<number>`sum(case when ${ledger.amount} > 0 then 1 else 0 end)`
		})
		.from(ledger)
		.where(all(gte(ledger.createdAt, firstDay), lt(ledger.createdAt, end), scoped(ledger.projectId, projectId)))
		.groupBy(sql`1`);
	const byDay = new Map(rows.map((r) => [Number(r.day), { volume: Number(r.volume ?? 0), count: Number(r.n ?? 0) }]));
	return Array.from({ length: days }, (_, i) => {
		const day = firstDay + i * DAY;
		return { day, ...(byDay.get(day) ?? { volume: 0, count: 0 }) };
	});
}

async function recentEvents(db: DB, projectId: string | null) {
	const rows = await db
		.select({ event, delivery, projectName: project.name })
		.from(event)
		.innerJoin(project, eq(project.id, event.projectId))
		.leftJoin(delivery, latestDeliveryJoin)
		.where(scoped(event.projectId, projectId))
		.orderBy(desc(event.id))
		.limit(10);
	return rows.map((r) => ({
		id: r.event.id,
		type: r.event.type,
		subjectId: r.event.subjectId,
		subjectHref: subjectHref(r.event.type, r.event.subjectId),
		amount: typeof r.event.data.amount === 'number' ? r.event.data.amount : null,
		projectName: r.projectName,
		createdAt: r.event.createdAt,
		delivery: summarizeDelivery(r.delivery)
	}));
}

/** The fresh-install checklist, or null once there is a project. */
export async function setupChecklist(db: DB, config: Config) {
	const [projects] = await db.select({ n: count() }).from(project);
	if ((projects?.n ?? 0) > 0) return null;
	return {
		providers: config.providers.bonum || config.providers.qpay
	};
}

export async function overview(db: DB, config: Config, input: { projectId: string | null; period: Period; now?: number }) {
	const now = input.now ?? Date.now();
	const days = PERIODS[input.period];
	const setup = await setupChecklist(db, config);
	if (setup) return { setup, attention: [], kpis: null, daily: [], recent: [], health: [] };
	const [att, k, daily, recent, healthMap, projects] = await Promise.all([
		attention(db, config, input.projectId, now),
		kpis(db, input.projectId, days, now),
		dailyVolume(db, input.projectId, days, now),
		recentEvents(db, input.projectId),
		deliveryHealth(db, now),
		db
			.select({ id: project.id, name: project.name, webhookUrl: project.webhookUrl })
			.from(project)
			.where(and(isNull(project.archivedAt), input.projectId ? eq(project.id, input.projectId) : undefined))
			.orderBy(project.name)
	]);
	const health = projects.map((p) => ({
		...p,
		...(healthMap.get(p.id) ?? { total: 0, delivered: 0, failing: 0, lastFailureAt: null })
	}));
	return { setup: null, attention: att, kpis: k, daily, recent, health };
}
