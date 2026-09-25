/**
 * The monthly usage meter per project: how many payments and how much money,
 * derived from `ledger` (each provider payment exactly once; reversals are
 * negative rows).
 */
import { and, count, gte, lt, sql, sum, eq } from 'drizzle-orm';
import type { DB } from './db';
import { ledger } from './schema';

export type UsageRow = {
	projectId: string;
	/** `YYYY-MM`, Ulaanbaatar time */
	month: string;
	/** Ledger rows (payments and reversals) */
	count: number;
	/** Net integer MNT */
	volume: number;
};

/** Ulaanbaatar is UTC+8 all year (no DST). */
const UB_OFFSET_MS = 8 * 3600_000;

/** The bounds of a `YYYY-MM` month in Ulaanbaatar time, as epoch ms. */
export function monthBounds(month: string): { start: number; end: number } {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m) throw new Error('month must be YYYY-MM');
	const year = Number(m[1]);
	const mon = Number(m[2]) - 1;
	if (mon < 0 || mon > 11) throw new Error('month must be YYYY-MM');
	return { start: Date.UTC(year, mon, 1) - UB_OFFSET_MS, end: Date.UTC(year, mon + 1, 1) - UB_OFFSET_MS };
}

/** Usage for one month, per project (or for one project). Projects with no payments are absent. */
export async function monthlyUsage(db: DB, input: { month: string; projectId?: string }): Promise<UsageRow[]> {
	const { start, end } = monthBounds(input.month);
	const rows = await db
		.select({ projectId: ledger.projectId, count: count(), volume: sum(ledger.amount) })
		.from(ledger)
		.where(
			and(
				gte(ledger.createdAt, start),
				lt(ledger.createdAt, end),
				input.projectId ? eq(ledger.projectId, input.projectId) : sql`1 = 1`
			)
		)
		.groupBy(ledger.projectId);
	return rows.map((r) => ({ projectId: r.projectId, month: input.month, count: r.count, volume: Number(r.volume ?? 0) }));
}
