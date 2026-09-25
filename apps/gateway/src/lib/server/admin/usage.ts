/**
 * The Usage page: `monthlyUsage` (usage.ts) per project, split by kind, with
 * the events emitted in the same month. Months are Ulaanbaatar time, as in `monthlyUsage`.
 */
import { and, count, gte, lt, sql } from 'drizzle-orm';
import { monthOf } from '$lib/format';
import type { DB } from '../db';
import { event, ledger, project } from '../schema';
import { monthBounds, monthlyUsage } from '../usage';
import { scoped } from './common';

export function monthFrom(url: URL, now = Date.now()): string {
	const m = url.searchParams.get('month');
	if (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return m;
	return monthOf(now);
}

export type UsageLine = {
	projectId: string;
	name: string;
	payments: number;
	volume: number;
	invoices: number;
	renewals: number;
	charges: number;
	events: number;
};

export async function usageTable(db: DB, input: { month: string; projectId: string | null }) {
	const { start, end } = monthBounds(input.month);
	const [base, kinds, events, projects] = await Promise.all([
		monthlyUsage(db, { month: input.month, projectId: input.projectId ?? undefined }),
		db
			.select({
				projectId: ledger.projectId,
				kind: ledger.kind,
				n: sql<number>`sum(case when ${ledger.amount} > 0 then 1 else 0 end)`
			})
			.from(ledger)
			.where(and(gte(ledger.createdAt, start), lt(ledger.createdAt, end), scoped(ledger.projectId, input.projectId)))
			.groupBy(ledger.projectId, ledger.kind),
		db
			.select({ projectId: event.projectId, n: count() })
			.from(event)
			.where(and(gte(event.createdAt, start), lt(event.createdAt, end), scoped(event.projectId, input.projectId)))
			.groupBy(event.projectId),
		db.select({ id: project.id, name: project.name }).from(project).orderBy(project.name)
	]);
	const lines: UsageLine[] = [];
	for (const p of projects) {
		if (input.projectId && p.id !== input.projectId) continue;
		const u = base.find((b) => b.projectId === p.id);
		const k = (kind: string) => Number(kinds.find((r) => r.projectId === p.id && r.kind === kind)?.n ?? 0);
		const ev = events.find((e) => e.projectId === p.id)?.n ?? 0;
		if (!u && ev === 0) continue;
		lines.push({
			projectId: p.id,
			name: p.name,
			payments: u?.count ?? 0,
			volume: u?.volume ?? 0,
			invoices: k('invoice'),
			renewals: k('subscription'),
			charges: k('charge'),
			events: ev
		});
	}
	const total = lines.reduce(
		(t, l) => ({
			payments: t.payments + l.payments,
			volume: t.volume + l.volume,
			invoices: t.invoices + l.invoices,
			renewals: t.renewals + l.renewals,
			charges: t.charges + l.charges,
			events: t.events + l.events
		}),
		{ payments: 0, volume: 0, invoices: 0, renewals: 0, charges: 0, events: 0 }
	);
	return { lines, total };
}
