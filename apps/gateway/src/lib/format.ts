/**
 * Display formatting for the dashboard and the public pages (ux-brief §5).
 * Pure functions, safe on the server and in the browser.
 *
 * - Money is integer MNT: `₮12,500`, no decimals.
 * - Times are epoch-ms UTC, shown in Ulaanbaatar time (UTC+8, no DST).
 */

export const DISPLAY_TZ = 'Asia/Ulaanbaatar';
const UB_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

const mnt = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'MNT',
	currencyDisplay: 'narrowSymbol',
	maximumFractionDigits: 0
});
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `₮12,500`; negative amounts use the true minus sign: `−₮12,500`. */
export function formatMoney(amount: number): string {
	const s = mnt.format(Math.abs(amount));
	return amount < 0 ? `−${s}` : s;
}

/** KPI form: `₮12.4M`, `₮850K`, `₮900`. Never in tables or on detail pages. */
export function formatMoneyCompact(amount: number): string {
	const s = `₮${compact.format(Math.abs(amount))}`;
	return amount < 0 ? `−${s}` : s;
}

/** For screen readers: `12,500 tugrik`. */
export function moneyLabel(amount: number): string {
	return `${amount < 0 ? 'minus ' : ''}${plain.format(Math.abs(amount))} tugrik`;
}

/** `1,284` */
export function formatCount(n: number): string {
	return plain.format(n);
}

/** `1 attempt` / `3 attempts` */
export function plural(n: number, one: string, other: string): string {
	return `${formatCount(n)} ${n === 1 ? one : other}`;
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** Wall-clock parts in UB time (fixed UTC+8, so plain arithmetic is exact). */
function ubParts(ms: number): Parts {
	const t = new Date(ms + UB_OFFSET_MS);
	return {
		y: t.getUTCFullYear(),
		mo: t.getUTCMonth(),
		d: t.getUTCDate(),
		h: t.getUTCHours(),
		mi: t.getUTCMinutes(),
		s: t.getUTCSeconds()
	};
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `25 Sep 2026, 14:05:32` (detail pages, timeline). */
export function formatDateTime(ms: number): string {
	const p = ubParts(ms);
	return `${p.d} ${MONTHS[p.mo]} ${p.y}, ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** `25 Sep 2026` */
export function formatDate(ms: number): string {
	const p = ubParts(ms);
	return `${p.d} ${MONTHS[p.mo]} ${p.y}`;
}

/** `25 Sep` (current year) or `25 Sep 2025`. */
export function formatShortDate(ms: number, now = Date.now()): string {
	const p = ubParts(ms);
	return p.y === ubParts(now).y ? `${p.d} ${MONTHS[p.mo]}` : `${p.d} ${MONTHS[p.mo]} ${p.y}`;
}

/** `25 Sep, 14:05`, with the year when it is not the current one. */
export function formatShortDateTime(ms: number, now = Date.now()): string {
	const p = ubParts(ms);
	return `${formatShortDate(ms, now)}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** Tooltip on every time: `25 Sep 2026, 14:05:32 UB · 06:05:32 UTC`. */
export function formatTooltip(ms: number): string {
	const u = new Date(ms);
	return `${formatDateTime(ms)} UB · ${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}:${pad(u.getUTCSeconds())} UTC`;
}

/** `just now`, `3 min ago`, `5 h ago`, `2 days ago` for the past; `in 3 h`, `in 12 min` for the future. */
export function formatRelative(ms: number, now = Date.now()): string {
	const diff = now - ms;
	const abs = Math.abs(diff);
	let text: string;
	if (abs < MINUTE) return diff >= 0 ? 'just now' : 'in less than a minute';
	if (abs < HOUR) text = `${Math.floor(abs / MINUTE)} min`;
	else if (abs < DAY) text = `${Math.floor(abs / HOUR)} h`;
	else text = plural(Math.floor(abs / DAY), 'day', 'days');
	return diff >= 0 ? `${text} ago` : `in ${text}`;
}

/** Table cells: relative under 24 h, otherwise `25 Sep, 14:05`. */
export function formatTableTime(ms: number, now = Date.now()): string {
	const diff = now - ms;
	if (diff >= 0 && diff < DAY) return formatRelative(ms, now);
	return formatShortDateTime(ms, now);
}

/** Future times (next bill, expiry): `in 12 min`, `in 5 h`, else `on 25 Oct`. Past: as a table time. */
export function formatFuture(ms: number, now = Date.now()): string {
	const diff = ms - now;
	if (diff < 0) return formatTableTime(ms, now);
	if (diff < DAY) return formatRelative(ms, now);
	return `on ${formatShortDate(ms, now)}`;
}

/** `14:32` countdown (minutes:seconds), for checkout expiry. */
export function formatCountdown(msLeft: number): string {
	const total = Math.max(0, Math.floor(msLeft / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** `2026-09` for a time, in UB time. */
export function monthOf(ms: number): string {
	const p = ubParts(ms);
	return `${p.y}-${pad(p.mo + 1)}`;
}

/** `September 2026` for `2026-09`. */
export function formatMonth(month: string): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** `2026-08` for `2026-09`, `-1`. */
export function addMonths(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number) as [number, number];
	const idx = y * 12 + (m - 1) + delta;
	return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** Start of the UB day containing `ms`, as epoch ms. */
export function ubDayStart(ms: number): number {
	return Math.floor((ms + UB_OFFSET_MS) / DAY) * DAY - UB_OFFSET_MS;
}

/* ------------------------------------------------------------------ *
 * Ids, masks, URLs
 * ------------------------------------------------------------------ */

/** `01J8ZK…Q3ZK`: the start and the last 4 characters. Short ids are left alone. */
export function truncateMiddle(id: string, head = 6, tail = 4): string {
	return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** `abc…` at `max` characters. */
export function truncateEnd(text: string, max = 32): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Bonum's `5150 23** **** 4778` → `•••• 4778`. */
export function formatCardMask(mask: string | null | undefined): string {
	if (!mask) return '—';
	const digits = mask.replace(/[^0-9]/g, '');
	return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : mask;
}

/** Bonum's `2026/11` → `11/26`. */
export function formatCardExpiry(expiry: string | null | undefined): string | null {
	if (!expiry) return null;
	const m = /^(\d{4})[/-](\d{1,2})$/.exec(expiry.trim());
	return m ? `${pad(Number(m[2]))}/${m[1]!.slice(2)}` : expiry;
}

/** The host of a URL (`nomad.example.com`), or null. */
export function hostOf(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}

/** `bgk_7Hq1a2b3••••` style display of a key prefix. */
export function maskedKey(prefix: string): string {
	return `${prefix}••••••••`;
}
