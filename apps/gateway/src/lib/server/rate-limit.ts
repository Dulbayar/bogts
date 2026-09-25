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
 * The one statement that counts a hit on `key`: an upsert that resets the
 * window atomically when the stored one has elapsed, and returns the counter.
 * For a caller that puts it in its own `db.batch`; read it with `rateLimitResult`.
 */
export function rateLimitHit(db: DB, key: string, windowMs: number, now = Date.now()) {
	const cutoff = now - windowMs;
	return db
		.insert(rateLimit)
		.values({ key, count: 1, windowStart: now })
		.onConflictDoUpdate({
			target: rateLimit.key,
			set: {
				count: sql`case when ${rateLimit.windowStart} <= ${cutoff} then 1 else ${rateLimit.count} + 1 end`,
				windowStart: sql`case when ${rateLimit.windowStart} <= ${cutoff} then ${now} else ${rateLimit.windowStart} end`
			}
		})
		.returning({ count: rateLimit.count, windowStart: rateLimit.windowStart });
}

/** The verdict from `rateLimitHit`'s returned rows. */
export function rateLimitResult(
	rows: { count: number; windowStart: number }[],
	limit: number,
	windowMs: number,
	now = Date.now()
): RateLimitResult {
	const row = rows[0];
	const count = row?.count ?? 1;
	const resetAt = (row?.windowStart ?? now) + windowMs;
	return { ok: count <= limit, remaining: Math.max(0, limit - count), resetAt };
}

/**
 * Counts one hit on `key`. Returns ok=false once more than `limit` hits fall in
 * the current `windowMs` window. A single upsert statement (one round trip).
 */
export async function consumeRateLimit(
	db: DB,
	key: string,
	limit: number,
	windowMs: number,
	now = Date.now()
): Promise<RateLimitResult> {
	return rateLimitResult(await rateLimitHit(db, key, windowMs, now), limit, windowMs, now);
}

/** Clears a key (e.g. after a successful login). */
export async function resetRateLimit(db: DB, key: string): Promise<void> {
	await db.delete(rateLimit).where(eq(rateLimit.key, key));
}

/** Drops windows older than `maxAgeMs`; run from the cron. */
export async function purgeRateLimits(db: DB, now: number, maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
	await db.delete(rateLimit).where(lt(rateLimit.windowStart, now - maxAgeMs));
}
