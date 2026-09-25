import { describe, expect, it } from 'vitest';
import {
	addMonths,
	formatCardExpiry,
	formatCardMask,
	formatCountdown,
	formatDateTime,
	formatFuture,
	formatMoney,
	formatMoneyCompact,
	formatMonth,
	formatRelative,
	formatTableTime,
	formatTooltip,
	hostOf,
	moneyLabel,
	plural,
	truncateMiddle,
	ubDayStart
} from './format';
import { deliveryState, eventTypeTone, invoiceStatus, subscriptionStatus } from './status';

const NOW = Date.UTC(2026, 8, 25, 6, 5, 32); // 14:05:32 in Ulaanbaatar

describe('money', () => {
	it('formats integer MNT', () => {
		expect(formatMoney(1_234_500)).toBe('₮1,234,500');
		expect(formatMoney(-12_500)).toBe('−₮12,500');
		expect(formatMoneyCompact(12_400_000)).toBe('₮12.4M');
		expect(formatMoneyCompact(850_000)).toBe('₮850K');
		expect(moneyLabel(12_500)).toBe('12,500 tugrik');
		expect(plural(1, 'attempt', 'attempts')).toBe('1 attempt');
		expect(plural(3, 'attempt', 'attempts')).toBe('3 attempts');
	});
});

describe('time (Ulaanbaatar)', () => {
	it('formats absolute and tooltip times', () => {
		expect(formatDateTime(NOW)).toBe('25 Sep 2026, 14:05:32');
		expect(formatTooltip(NOW)).toBe('25 Sep 2026, 14:05:32 UB · 06:05:32 UTC');
	});
	it('is relative under 24 h in tables, absolute after', () => {
		expect(formatTableTime(NOW - 10_000, NOW)).toBe('just now');
		expect(formatTableTime(NOW - 3 * 60_000, NOW)).toBe('3 min ago');
		expect(formatTableTime(NOW - 5 * 3600_000, NOW)).toBe('5 h ago');
		expect(formatTableTime(NOW - 2 * 86_400_000, NOW)).toBe('23 Sep, 14:05');
		expect(formatTableTime(Date.UTC(2025, 8, 25, 6, 5), NOW)).toBe('25 Sep 2025, 14:05');
	});
	it('formats future times', () => {
		expect(formatFuture(NOW + 12 * 60_000, NOW)).toBe('in 12 min');
		expect(formatFuture(NOW + 30 * 86_400_000, NOW)).toBe('on 25 Oct');
		expect(formatRelative(NOW + 3 * 86_400_000, NOW)).toBe('in 3 days');
		expect(formatCountdown(14 * 60_000 + 32_000)).toBe('14:32');
	});
	it('computes UB days and months', () => {
		// 23:30 UTC on the 24th is 07:30 on the 25th in UB.
		expect(ubDayStart(Date.UTC(2026, 8, 24, 23, 30))).toBe(Date.UTC(2026, 8, 24, 16, 0));
		expect(formatMonth('2026-09')).toBe('September 2026');
		expect(addMonths('2026-01', -1)).toBe('2025-12');
		expect(addMonths('2026-12', 1)).toBe('2027-01');
	});
});

describe('ids, cards, urls', () => {
	it('truncates and masks', () => {
		expect(truncateMiddle('01J8ZKABCDEFGHJKMNPQRSQ3ZK')).toBe('01J8ZK…Q3ZK');
		expect(formatCardMask('5150 23** **** 4778')).toBe('•••• 4778');
		expect(formatCardExpiry('2026/11')).toBe('11/26');
		expect(hostOf('https://nomad.example.com/hooks/bogts')).toBe('nomad.example.com');
		expect(hostOf('nope')).toBeNull();
	});
});

describe('status vocabulary', () => {
	it('maps DB values to tone + label', () => {
		expect(invoiceStatus('paid')).toEqual({ tone: 'success', label: 'Paid' });
		expect(subscriptionStatus('past_due')).toEqual({ tone: 'warning', label: 'Payment failed' });
		expect(deliveryState({ status: 'pending', attempts: 0, lastError: null })).toBe('queued');
		expect(deliveryState({ status: 'pending', attempts: 2, lastError: 'http_500' })).toBe('retrying');
		expect(deliveryState({ status: 'failed', attempts: 0, lastError: 'no_webhook_url' })).toBe('skipped');
		expect(eventTypeTone('subscription.payment_failed')).toBe('danger');
		expect(eventTypeTone('invoice.expired')).toBe('muted');
	});
});
