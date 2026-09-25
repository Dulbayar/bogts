/**
 * Fixed-window counters in D1 (`rate_limit`). Used for admin login attempts,
 * where a few extra attempts slipping through a race do not matter but an
 * unlimited brute force does.
 */
import { eq, lt, sql } from 'drizzle-orm';
import type { DB } from './db';
import { rateLimit } from './schema';

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number };

/**
 * Counts one hit on `key`. Returns ok=false once more than `limit` hits fall in
 * the current `windowMs` window. A single upsert statement: the window resets
 * atomically when the stored one has elapsed.
 */
export async function consumeRateLimit(
	db: DB,
	key: string,
	limit: number,
	windowMs: number,
	now = Date.now()
): Promise<RateLimitResult> {
	const cutoff = now - windowMs;
	await db
		.insert(rateLimit)
		.values({ key, count: 1, windowStart: now })
		.onConflictDoUpdate({
			target: rateLimit.key,
			set: {
				count: sql`case when ${rateLimit.windowStart} <= ${cutoff} then 1 else ${rateLimit.count} + 1 end`,
				windowStart: sql`case when ${rateLimit.windowStart} <= ${cutoff} then ${now} else ${rateLimit.windowStart} end`
			}
		});
	const row = await db.query.rateLimit.findFirst({ where: eq(rateLimit.key, key) });
	const count = row?.count ?? 1;
	const resetAt = (row?.windowStart ?? now) + windowMs;
	return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

/** Clears a key (e.g. after a successful login). */
export async function resetRateLimit(db: DB, key: string): Promise<void> {
	await db.delete(rateLimit).where(eq(rateLimit.key, key));
}

/** Drops windows older than `maxAgeMs`; run from the cron. */
export async function purgeRateLimits(db: DB, now: number, maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
	await db.delete(rateLimit).where(lt(rateLimit.windowStart, now - maxAgeMs));
}
