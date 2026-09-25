/**
 * The Overview page: what needs attention, the period's KPIs, daily volume,
 * recent events and delivery health. Every number comes from the ledger, the
 * outbox or current state; nothing is estimated.
 *
 * Performance: the page is one `db.batch` (one D1 round trip) of independent
 * reads, each backed by an index (docs/performance.md).
 */
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { DB } from '../db';
import type { Config } from '../env';
import { activity, charge, delivery, event, invoice, ledger, plan, project, subscription, type Plan } from '../schema';
import { formatMoney, ubDayStart } from '$lib/format';
import { all, isLatestDelivery, latestDeliveryJoin, scoped, summarizeDelivery } from './common';
import { failingCond, subjectHref } from './events';
import { deploymentMode } from './health';
import { deliveryHealthFrom, deliveryHealthQuery, planChecksFrom, planValidations, type PlanCheckView } from './projects';

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

/** Activity kinds read by "Needs attention" within the 30-day window (one query for all of them). */
const WINDOW_KINDS = [...new Set(['invoice.duplicate_payment', 'qpay.extra_payment', ...ACTIVITY_FLAGS.flatMap((f) => f.kinds)])];

/** The period as whole Ulaanbaatar calendar days ending today: the chart's bars, [start, end). */
export function periodWindow(days: number, now: number): { start: number; end: number } {
	const start = ubDayStart(now) - (days - 1) * DAY;
	return { start, end: start + days * DAY };
}

const UB_OFFSET = 8 * 3600_000;

/**
 * Every read the Overview needs, as statements for ONE `db.batch` (one D1
 * round trip). None depends on another's result: plan checks read their audit
 * entries through a subquery rather than a list of plan ids.
 */
function overviewStatements(db: DB, config: Config, projectId: string | null, days: number, now: number) {
	const { start, end } = periodWindow(days, now);
	const prevStart = start - days * DAY;
	const livePlans = all(
		eq(plan.active, true),
		inArray(plan.projectId, db.select({ id: project.id }).from(project).where(isNull(project.archivedAt))),
		scoped(plan.projectId, projectId)
	);
	const flagProject = sql<string>`coalesce(${invoice.projectId}, ${subscription.projectId})`;
	return [
		/* 0: setup checklist */
		db.select({ n: count() }).from(project),

		/* 1: failing deliveries per project (same rows as the events list's `?status=failing`) */
		db
			.select({ projectId: delivery.projectId, name: project.name, n: count() })
			.from(delivery)
			.innerJoin(project, eq(project.id, delivery.projectId))
			.where(all(failingCond(now), isLatestDelivery, scoped(delivery.projectId, projectId)))
			.groupBy(delivery.projectId, project.name)
			.orderBy(delivery.projectId),

		/* 2: subscription numbers, one pass */
		db
			.select({
				pastDue: sql<number>`coalesce(sum(case when ${subscription.status} = 'past_due' then 1 else 0 end), 0)`,
				active: sql<number>`coalesce(sum(case when ${subscription.status} = 'active' then 1 else 0 end), 0)`,
				started: sql<number>`coalesce(sum(case when ${subscription.createdAt} >= ${start} and ${subscription.createdAt} < ${end} and ${subscription.status} in ('active', 'past_due', 'cancelled') then 1 else 0 end), 0)`,
				ended: sql<number>`coalesce(sum(case when ${subscription.cancelledAt} is not null and ${subscription.cancelledAt} >= ${start} and ${subscription.cancelledAt} < ${end} then 1 else 0 end), 0)`
			})
			.from(subscription)
			.where(scoped(subscription.projectId, projectId)),

		/* 3: charges with no outcome an hour on */
		db
			.select({ id: charge.id, amount: charge.amount, reference: charge.reference })
			.from(charge)
			.where(all(eq(charge.status, 'pending'), lt(charge.createdAt, now - 3600_000), scoped(charge.projectId, projectId)))
			.orderBy(charge.createdAt)
			.limit(STUCK_LIMIT + 1),

		/* 4: two live Bonum mandates for the same customer and plan (reported by the Bonum module) */
		db
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
			.limit(STUCK_LIMIT),

		/* 5: findings in the last 30 days, one row per (subject, kind) */
		db
			.select({
				subjectType: activity.subjectType,
				kind: activity.kind,
				subjectId: sql<string>`${activity.subjectId}`,
				last: sql<number>`max(${activity.createdAt})`,
				projectId: flagProject,
				reference: invoice.reference
			})
			.from(activity)
			.leftJoin(invoice, and(eq(activity.subjectType, 'invoice'), eq(invoice.id, activity.subjectId)))
			.leftJoin(subscription, and(eq(activity.subjectType, 'subscription'), eq(subscription.id, activity.subjectId)))
			.where(
				all(
					inArray(activity.kind, WINDOW_KINDS),
					gte(activity.createdAt, now - PAID_TWICE_WINDOW_MS),
					or(isNotNull(invoice.id), isNotNull(subscription.id)),
					projectId ? sql`${flagProject} = ${projectId}` : undefined
				)
			)
			.groupBy(activity.subjectType, activity.kind, activity.subjectId),

		/* 6, 7: active plans of live projects, and their validation entries */
		db.select().from(plan).where(livePlans),
		planValidations(db, db.select({ id: plan.id }).from(plan).where(livePlans)),

		/* 8: projects without a webhook URL */
		db
			.select({ id: project.id, name: project.name })
			.from(project)
			.where(all(isNull(project.webhookUrl), isNull(project.archivedAt), projectId ? eq(project.id, projectId) : undefined)),

		/* 9: any QPay invoice (matters only when QPay is not configured) */
		db
			.select({ one: sql<number>`1` })
			.from(invoice)
			.where(all(eq(invoice.provider, 'qpay'), scoped(invoice.projectId, projectId), config.providers.qpay ? sql`0` : undefined))
			.limit(1),

		/* 10: net volume and payments per UB day over this period and the previous one */
		db
			.select({
				day: sql<number>`((${ledger.createdAt} + ${sql.raw(String(UB_OFFSET))}) / ${sql.raw(String(DAY))}) * ${sql.raw(String(DAY))} - ${sql.raw(String(UB_OFFSET))}`,
				volume: sql<number>`sum(${ledger.amount})`,
				n: sql<number>`sum(case when ${ledger.amount} > 0 then 1 else 0 end)`
			})
			.from(ledger)
			.where(all(gte(ledger.createdAt, prevStart), lt(ledger.createdAt, end), scoped(ledger.projectId, projectId)))
			.groupBy(sql`1`),

		/* 11, 12: finished invoices and charges created in the period (success rate) */
		db
			.select({ status: invoice.status, n: count() })
			.from(invoice)
			.where(all(gte(invoice.createdAt, start), lt(invoice.createdAt, end), inArray(invoice.status, ['paid', 'failed', 'expired']), scoped(invoice.projectId, projectId)))
			.groupBy(invoice.status),
		db
			.select({ status: charge.status, n: count() })
			.from(charge)
			.where(all(gte(charge.createdAt, start), lt(charge.createdAt, end), inArray(charge.status, ['succeeded', 'failed', 'reversed']), scoped(charge.projectId, projectId)))
			.groupBy(charge.status),

		/* 13: recent events */
		db
			.select({ event, delivery, projectName: project.name })
			.from(event)
			.innerJoin(project, eq(project.id, event.projectId))
			.leftJoin(delivery, latestDeliveryJoin)
			.where(scoped(event.projectId, projectId))
			.orderBy(desc(event.id))
			.limit(10),

		/* 14: delivery health per project */
		deliveryHealthQuery(db, now),

		/* 15: the projects shown in the health table */
		db
			.select({ id: project.id, name: project.name, webhookUrl: project.webhookUrl })
			.from(project)
			.where(and(isNull(project.archivedAt), projectId ? eq(project.id, projectId) : undefined))
			.orderBy(project.name)
	] as const;
}

type Flag = { subjectType: string; kind: string; subjectId: string; last: number; projectId: string; reference: string | null };

/** Distinct keys of `rows` (by `key`), with the newest `last` of each, newest first. */
function newestBy<T extends { last: number }>(rows: T[], key: (r: T) => string): { key: string; row: T; last: number }[] {
	const out = new Map<string, { key: string; row: T; last: number }>();
	for (const r of rows) {
		const k = key(r);
		const seen = out.get(k);
		if (!seen || r.last > seen.last) out.set(k, { key: k, row: r, last: Number(r.last) });
	}
	return [...out.values()].sort((a, b) => b.last - a.last);
}

function attention(
	config: Config,
	projectId: string | null,
	rows: {
		failing: { projectId: string; name: string; n: number }[];
		pastDue: number;
		stuck: { id: string; amount: number; reference: string }[];
		dupes: { id: string; customerRef: string }[];
		flags: Flag[];
		plans: Plan[];
		checks: Map<string, PlanCheckView>;
		noHook: { id: string; name: string }[];
		qpayUsed: boolean;
	}
): AttentionItem[] {
	const items: AttentionItem[] = [];
	const scopeQ = projectId ? `&project=${projectId}` : '';

	// Failing deliveries, per project.
	for (const f of rows.failing) {
		items.push({
			tone: 'danger',
			text: `**${f.n}** webhook ${f.n === 1 ? 'delivery is' : 'deliveries are'} failing for **${f.name}**`,
			href: `/admin/events?status=failing&project=${f.projectId}`
		});
	}

	// Past-due subscriptions.
	if (rows.pastDue > 0) {
		items.push({
			tone: 'warning',
			text: `**${rows.pastDue}** ${rows.pastDue === 1 ? 'subscription has' : 'subscriptions have'} a failed payment`,
			href: `/admin/subscriptions?status=past_due${scopeQ}`
		});
	}

	// Charges with no outcome an hour on: Bonum has no production status API, and the money may have moved.
	for (const c of rows.stuck.slice(0, STUCK_LIMIT)) {
		items.push({
			tone: 'danger',
			text: `Charge **${formatMoney(c.amount)}** (\`${c.reference}\`) has no result after an hour: check the Bonum merchant portal`,
			href: `/admin/charges/${c.id}`
		});
	}
	if (rows.stuck.length > STUCK_LIMIT) {
		items.push({ tone: 'danger', text: 'More charges have no result after an hour', href: `/admin/charges?status=pending${scopeQ}` });
	}

	for (const d of rows.dupes) {
		items.push({
			tone: 'danger',
			text: `**${d.customerRef}** has two live Bonum subscriptions for the same plan`,
			href: `/admin/subscriptions/${d.id}`
		});
	}

	const flagged = (subjectType: string, kinds: string[]) =>
		rows.flags.filter((f) => f.subjectType === subjectType && kinds.includes(f.kind));

	// One purchase (project + reference) paid by two invoices: refund one.
	const twice = newestBy(flagged('invoice', ['invoice.duplicate_payment']), (f) => `${f.projectId}\u0000${f.reference}`);
	const newestTwice = twice[0]?.row;
	if (newestTwice) {
		items.push({
			tone: 'danger',
			text: `**${twice.length}** ${twice.length === 1 ? 'reference' : 'references'} paid twice: refund one`,
			href: `/admin/payments?reference=${encodeURIComponent(newestTwice.reference ?? '')}&project=${newestTwice.projectId}`
		});
	}

	// One QPay invoice that payment/check shows paid more than once.
	const extra = newestBy(flagged('invoice', ['qpay.extra_payment']), (f) => f.subjectId);
	if (extra.length) {
		items.push({
			tone: 'danger',
			text: `**${extra.length}** QPay ${extra.length === 1 ? 'invoice was' : 'invoices were'} paid more than once: refund the extra payment`,
			href: extra.length === 1 ? `/admin/payments/${extra[0]!.key}` : `/admin/payments?provider=qpay&status=paid${scopeQ}`
		});
	}

	// Findings recorded as activity (last 30 days), one line per kind with a count,
	// linking to the newest subject.
	for (const f of ACTIVITY_FLAGS) {
		const subjects = newestBy(flagged(f.subject, f.kinds), (r) => r.subjectId);
		const newest = subjects[0];
		if (!newest) continue;
		items.push({
			tone: f.tone,
			text: f.text(subjects.length),
			href: f.subject === 'invoice' ? `/admin/payments/${newest.key}` : `/admin/subscriptions/${newest.key}`
		});
	}

	// Plans that don't match Bonum (archived projects' plans are not in use).
	const mismatched = rows.plans.filter((p) => rows.checks.get(p.id)?.status === 'mismatch');
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
	for (const p of rows.noHook) {
		items.push({
			tone: 'warning',
			text: `**${p.name}** has no webhook URL: events are stored but not sent`,
			href: `/admin/projects/${p.id}?tab=webhook`
		});
	}

	// A provider that is used but not configured.
	if (!config.providers.qpay && rows.qpayUsed) {
		items.push({ tone: 'warning', text: '**QPay** is not configured', href: '/admin/settings' });
	}
	if (!config.providers.bonum && rows.plans.length > 0) {
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

/** The fresh-install checklist, or null once there is a project. */
export async function setupChecklist(db: DB, config: Config) {
	const [projects] = await db.select({ n: count() }).from(project);
	return setupFrom(projects?.n ?? 0, config);
}

function setupFrom(projectCount: number, config: Config) {
	if (projectCount > 0) return null;
	return {
		providers: config.providers.bonum || config.providers.qpay
	};
}

/** The whole page from one `db.batch` (one D1 round trip); see `overviewStatements`. */
export async function overview(db: DB, config: Config, input: { projectId: string | null; period: Period; now?: number }) {
	const now = input.now ?? Date.now();
	const days = PERIODS[input.period];
	const { projectId } = input;
	const [
		[projectCount],
		failing,
		[subs],
		stuck,
		dupes,
		flags,
		plans,
		validations,
		noHook,
		qpayAny,
		ledgerDays,
		inv,
		chg,
		recentRows,
		healthRows,
		projects
	] = await db.batch(overviewStatements(db, config, projectId, days, now));

	const setup = setupFrom(projectCount?.n ?? 0, config);
	if (setup) return { setup, attention: [], kpis: null, daily: [], recent: [], health: [] };

	const att = attention(config, projectId, {
		failing,
		pastDue: Number(subs?.pastDue ?? 0),
		stuck,
		dupes,
		flags: flags as Flag[],
		plans,
		checks: planChecksFrom(plans, validations),
		noHook,
		qpayUsed: qpayAny.length > 0
	});

	// KPIs. The ledger rows are per UB day, this period and the previous one.
	const { start } = periodWindow(days, now);
	const byDay = new Map<number, { volume: number; count: number }>();
	const prev = { volume: 0, payments: 0 };
	const cur = { volume: 0, payments: 0 };
	for (const r of ledgerDays) {
		const day = Number(r.day);
		const volume = Number(r.volume ?? 0);
		const n = Number(r.n ?? 0);
		const into = day < start ? prev : cur;
		into.volume += volume;
		into.payments += n;
		if (day >= start) byDay.set(day, { volume, count: n });
	}
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
	const kpis = {
		volume: cur.volume,
		payments: cur.payments,
		/** null when the previous period had too few payments to compare */
		volumeDelta: prev.payments >= MIN_RATE_BASE && prev.volume > 0 ? (cur.volume - prev.volume) / prev.volume : null,
		successRate: finished >= MIN_RATE_BASE ? good / finished : null,
		finished,
		activeSubscriptions: Number(subs?.active ?? 0),
		subscriptionsStarted: Number(subs?.started ?? 0),
		subscriptionsEnded: Number(subs?.ended ?? 0)
	};

	// Daily net volume and payment count, UB days, oldest first, one entry per day (zeros included).
	const daily = Array.from({ length: days }, (_, i) => {
		const day = start + i * DAY;
		return { day, ...(byDay.get(day) ?? { volume: 0, count: 0 }) };
	});

	const recent = recentRows.map((r) => ({
		id: r.event.id,
		type: r.event.type,
		subjectId: r.event.subjectId,
		subjectHref: subjectHref(r.event.type, r.event.subjectId),
		amount: typeof r.event.data.amount === 'number' ? r.event.data.amount : null,
		projectName: r.projectName,
		createdAt: r.event.createdAt,
		delivery: summarizeDelivery(r.delivery)
	}));

	const healthMap = deliveryHealthFrom(healthRows);
	const health = projects.map((p) => ({
		...p,
		...(healthMap.get(p.id) ?? { total: 0, delivered: 0, failing: 0, lastFailureAt: null })
	}));
	return { setup: null, attention: att, kpis, daily, recent, health };
}
