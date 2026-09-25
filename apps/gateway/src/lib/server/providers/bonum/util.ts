/** Small Bonum helpers: its timestamps, plan intervals and follow-up links. */
import type { PlanInterval } from '../../schema';
import { BonumError } from './client';

/** Mongolia (Ulaanbaatar) is UTC+8 all year; Bonum's timestamps are local and carry no offset. */
const UB_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Bonum's timestamps (`completedAt`, `nextBillingDate`, `lastBilledAt`, …) are
 * `2026-01-27 02:00:08` with no zone: Ulaanbaatar local time (UTC+8). Bonum's
 * own samples prove it: each response's `traceId` starts with the epoch
 * seconds it was minted at, and `0x6976ca6c` (01:59:08Z) came back with
 * `subscribedAt: "2026-01-26 09:59:11"`, i.e. 8 h ahead (and likewise for the
 * purchase samples). A string that does carry a zone (`Z`, `+08:00`) is read
 * with that zone instead. A date alone (`2026-02-02`, as `lastBilledAt` or
 * `nextBillAt` may come) is 00:00 Ulaanbaatar time that day. Epoch ms
 * (`updatedAt`) pass through. Returns null when absent or malformed.
 */
export function bonumTime(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value > 1e11) return value; // epoch ms (`updatedAt`)
	if (typeof value !== 'string') return null;
	const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (day) {
		const [y, mo, d] = day.slice(1, 4).map(Number) as [number, number, number];
		if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
		return Date.UTC(y, mo - 1, d) - UB_OFFSET_MS;
	}
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(value.trim());
	if (!m) return null;
	const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
	const ms = m[7] ? Math.floor(Number(`0${m[7]}`) * 1000) : 0;
	const zone = m[8];
	let offset = UB_OFFSET_MS;
	if (zone && zone.toUpperCase() !== 'Z') {
		const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!;
		offset = (z[1] === '-' ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60_000;
	} else if (zone) {
		offset = 0;
	}
	const utc = Date.UTC(y, mo - 1, d, h, mi, s, ms) - offset;
	return Number.isFinite(utc) ? utc : null;
}

/**
 * One line of a Bonum `items[]` (shown on Bonum's hosted page). The docs call
 * `items` optional, but Bonum's sandbox refuses an item without `remark`
 * (invoices) or without `image` and `remark` (card tokenization), so both are
 * always sent, empty when we have nothing to say. `image: ''` is sent only
 * where it was needed and accepted (tokenization).
 */
export function bonumItem(title: string, amount: number, opts: { image?: boolean } = {}) {
	return {
		...(opts.image ? { image: '' } : {}),
		title: title.slice(0, 200),
		remark: '',
		amount,
		count: 1
	};
}

/** Bonum's `recurringType` for a plan interval. */
export const RECURRING_TYPE: Record<PlanInterval, 'WEEKLY' | 'MONTHLY' | 'YEARLY'> = {
	weekly: 'WEEKLY',
	monthly: 'MONTHLY',
	yearly: 'YEARLY'
};

/**
 * `from` plus one interval, in Ulaanbaatar calendar terms. Monthly and yearly
 * periods land on `anchor`'s day of month (default: `from`'s), clamped to the
 * month's length, so they never drift: Jan 31 → Feb 28 → Mar 31.
 */
export function addInterval(from: number, interval: PlanInterval, anchor?: number | null): number {
	if (interval === 'weekly') return from + 7 * 24 * 60 * 60 * 1000;
	const local = new Date(from + UB_OFFSET_MS);
	const day = new Date((anchor ?? from) + UB_OFFSET_MS).getUTCDate();
	const target = new Date(local);
	target.setUTCDate(1);
	if (interval === 'monthly') target.setUTCMonth(target.getUTCMonth() + 1);
	else target.setUTCFullYear(target.getUTCFullYear() + 1);
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return target.getTime() - UB_OFFSET_MS;
}

/**
 * A renewal charge may run this long before its scheduled billing date and
 * still pay for that date's period (clock and zone slack).
 */
export const PERIOD_MATCH_MARGIN_MS = 12 * 60 * 60 * 1000;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The scheduled billing date that a charge made at `chargedAt` pays for: the
 * latest date of the schedule `anchor`, `anchor + 1 interval`, … (day of month
 * kept, as `addInterval`) that is at or before `chargedAt + PERIOD_MATCH_MARGIN_MS`.
 * Bonum's retries of a declined renewal, days later, still map to the same
 * date. Null when the charge is before the first scheduled date (the first,
 * `payNow` charge) or there is no anchor.
 *
 * It depends only on the charge's own time, never on the subscription's
 * current state, so a webhook and the reconciliation job that see the same
 * charge always agree on it.
 */
export function scheduledBillAt(chargedAt: number, anchor: number | null | undefined, interval: PlanInterval): number | null {
	if (anchor === null || anchor === undefined || !Number.isFinite(anchor) || !Number.isFinite(chargedAt)) return null;
	const limit = chargedAt + PERIOD_MATCH_MARGIN_MS;
	if (limit < anchor) return null;
	if (interval === 'weekly') return anchor + Math.floor((limit - anchor) / WEEK_MS) * WEEK_MS;
	let at = anchor;
	for (let i = 0; i < 5000; i++) {
		const next = addInterval(at, interval, anchor);
		if (next > limit) return at;
		at = next;
	}
	return null;
}

/** The ledger `periodKey` of a renewal charge (see `scheduledBillAt`), or null. */
export function billingPeriodKey(chargedAt: number, anchor: number | null | undefined, interval: PlanInterval): string | null {
	const at = scheduledBillAt(chargedAt, anchor, interval);
	return at === null ? null : new Date(at).toISOString();
}

/**
 * The plan's `cycleValue` for today in Ulaanbaatar: ISO weekday (1 = Mon) for
 * weekly, day of month for monthly, day of year for yearly. Bonum ignores it
 * when `payNow` is true, but the field is part of the documented request.
 */
export function cycleValue(interval: PlanInterval, now: number): number {
	const local = new Date(now + UB_OFFSET_MS);
	if (interval === 'weekly') return ((local.getUTCDay() + 6) % 7) + 1;
	if (interval === 'monthly') return local.getUTCDate();
	const start = Date.UTC(local.getUTCFullYear(), 0, 1);
	const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
	return Math.floor((today - start) / 86_400_000) + 1;
}

/** A follow-up link is only trusted on `https://*.bonum.mn`. */
export function checkedFollowUpLink(value: unknown, operation: string): string {
	if (typeof value !== 'string' || !value) throw new BonumError(502, operation, 'invalid_response');
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new BonumError(502, operation, 'invalid_url');
	}
	const host = url.hostname.toLowerCase();
	if (url.protocol !== 'https:' || (host !== 'bonum.mn' && !host.endsWith('.bonum.mn')) || url.username || url.password) {
		throw new BonumError(502, operation, 'untrusted_host');
	}
	return url.toString();
}
