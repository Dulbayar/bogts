import { describe, expect, it } from 'vitest';
import { BonumError } from './client';
import { addInterval, billingPeriodKey, bonumTime, checkedFollowUpLink, cycleValue, scheduledBillAt } from './util';

describe('bonumTime', () => {
	it('reads Bonum local time as UTC+8', () => {
		expect(bonumTime('2026-01-27 02:00:08')).toBe(Date.UTC(2026, 0, 26, 18, 0, 8));
		expect(bonumTime('2026-02-02 00:00:00')).toBe(Date.UTC(2026, 1, 1, 16));
		expect(bonumTime(1769657291559)).toBe(1769657291559);
		expect(bonumTime('')).toBeNull();
		expect(bonumTime('yesterday')).toBeNull();
		expect(bonumTime(undefined)).toBeNull();
	});

	it('reads a date alone as 00:00 Ulaanbaatar time', () => {
		expect(bonumTime('2026-02-02')).toBe(Date.UTC(2026, 1, 1, 16));
		expect(bonumTime(' 2026-02-02 ')).toBe(bonumTime('2026-02-02 00:00:00'));
		expect(bonumTime('2026-13-02')).toBeNull();
		expect(bonumTime('2026-2-2')).toBeNull();
	});
});

describe('addInterval', () => {
	const at = (s: string) => bonumTime(s)!;
	it('adds a local calendar month, clamping to the last day', () => {
		expect(addInterval(at('2026-01-27 00:00:00'), 'monthly')).toBe(at('2026-02-27 00:00:00'));
		expect(addInterval(at('2026-01-31 00:00:00'), 'monthly')).toBe(at('2026-02-28 00:00:00'));
		expect(addInterval(at('2026-12-15 00:00:00'), 'monthly')).toBe(at('2027-01-15 00:00:00'));
	});
	it('keeps the anchor day of month, so periods do not drift at month end', () => {
		const anchor = at('2026-01-31 00:00:00');
		const feb = addInterval(anchor, 'monthly', anchor);
		expect(feb).toBe(at('2026-02-28 00:00:00'));
		const mar = addInterval(feb, 'monthly', anchor);
		expect(mar).toBe(at('2026-03-31 00:00:00'));
		expect(addInterval(mar, 'monthly', anchor)).toBe(at('2026-04-30 00:00:00'));
		// Without an anchor, Feb 28 moves on to Mar 28 (the old drift).
		expect(addInterval(feb, 'monthly')).toBe(at('2026-03-28 00:00:00'));
		const leap = at('2028-02-29 00:00:00');
		const y1 = addInterval(leap, 'yearly', leap);
		expect(y1).toBe(at('2029-02-28 00:00:00'));
		expect(addInterval(addInterval(addInterval(y1, 'yearly', leap), 'yearly', leap), 'yearly', leap)).toBe(at('2032-02-29 00:00:00'));
	});
	it('adds a week and a year', () => {
		expect(addInterval(at('2026-01-27 00:00:00'), 'weekly')).toBe(at('2026-02-03 00:00:00'));
		expect(addInterval(at('2028-02-29 00:00:00'), 'yearly')).toBe(at('2029-02-28 00:00:00'));
	});
});

describe('cycleValue', () => {
	it('is the Ulaanbaatar weekday, day of month, day of year', () => {
		const monday = bonumTime('2026-01-26 01:00:00')!; // still Sunday in UTC
		expect(cycleValue('weekly', monday)).toBe(1);
		expect(cycleValue('monthly', monday)).toBe(26);
		expect(cycleValue('yearly', bonumTime('2026-02-01 12:00:00')!)).toBe(32);
	});
});

describe('checkedFollowUpLink', () => {
	it('trusts only https *.bonum.mn', () => {
		expect(checkedFollowUpLink('https://ecommerce.bonum.mn/tokenize?id=abc', 'x')).toBe('https://ecommerce.bonum.mn/tokenize?id=abc');
		expect(checkedFollowUpLink('https://testecommerce.bonum.mn/tokenize?id=1', 'x')).toContain('testecommerce.bonum.mn');
		for (const bad of ['http://ecommerce.bonum.mn/x', 'https://bonum.mn.evil.com/x', 'https://evilbonum.mn/x', 'https://u:p@ecommerce.bonum.mn/', 'javascript:alert(1)', '', 42]) {
			expect(() => checkedFollowUpLink(bad, 'x')).toThrow(BonumError);
		}
	});
});

describe('scheduledBillAt / billingPeriodKey', () => {
	const at = (s: string) => bonumTime(s)!;
	const anchor = at('2026-01-31 00:00:00');
	it('maps a charge to the scheduled date it pays for, keeping the anchor day', () => {
		expect(scheduledBillAt(at('2026-01-31 02:00:08'), anchor, 'monthly')).toBe(anchor);
		expect(scheduledBillAt(at('2026-02-28 00:00:05'), anchor, 'monthly')).toBe(at('2026-02-28 00:00:00'));
		expect(scheduledBillAt(at('2026-03-31 01:00:00'), anchor, 'monthly')).toBe(at('2026-03-31 00:00:00'));
		// A retry days later pays for the same period.
		expect(scheduledBillAt(at('2026-03-03 02:00:00'), anchor, 'monthly')).toBe(at('2026-02-28 00:00:00'));
		// Up to 12 h early still counts for that date.
		expect(scheduledBillAt(at('2026-02-27 13:00:00'), anchor, 'monthly')).toBe(at('2026-02-28 00:00:00'));
		expect(scheduledBillAt(at('2026-02-27 11:00:00'), anchor, 'monthly')).toBe(anchor);
	});
	it('weekly and yearly', () => {
		const w = at('2026-01-27 00:00:00');
		expect(scheduledBillAt(at('2026-02-10 03:00:00'), w, 'weekly')).toBe(at('2026-02-10 00:00:00'));
		expect(scheduledBillAt(at('2027-01-27 03:00:00'), w, 'yearly')).toBe(at('2027-01-27 00:00:00'));
	});
	it('is null before the first scheduled date or without an anchor', () => {
		expect(scheduledBillAt(at('2026-01-26 09:59:11'), at('2026-01-27 00:00:00'), 'monthly')).toBeNull();
		expect(scheduledBillAt(at('2026-01-26 09:59:11'), null, 'monthly')).toBeNull();
		expect(billingPeriodKey(at('2026-01-27 02:00:08'), at('2026-01-27 00:00:00'), 'monthly')).toBe('2026-01-26T16:00:00.000Z');
		expect(billingPeriodKey(at('2026-01-26 02:00:08'), at('2026-01-27 00:00:00'), 'monthly')).toBeNull();
	});
});
