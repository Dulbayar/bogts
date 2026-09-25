import { describe, expect, it } from 'vitest';
import { MoneyError, formatMnt, isValidAmount, isVerificationCharge, toMnt } from './money';

describe('toMnt', () => {
	it('turns provider decimals into integer MNT', () => {
		expect(toMnt(10000.0)).toBe(10000);
		expect(toMnt('10000.00')).toBe(10000);
		expect(toMnt(5.0)).toBe(5);
		expect(toMnt(3)).toBe(3);
		expect(toMnt('0')).toBe(0);
	});

	it('absorbs float noise', () => {
		expect(toMnt(0.1 * 3 * 10)).toBe(3);
		expect(toMnt(49899.99999999999)).toBe(49900);
	});

	it('maps the 0.01 verification charge to 0', () => {
		expect(toMnt(0.01)).toBe(0);
		expect(toMnt('0.01')).toBe(0);
		expect(isVerificationCharge(0.01)).toBe(true);
		expect(isVerificationCharge('0.010')).toBe(true);
		expect(isVerificationCharge(1)).toBe(false);
		expect(isVerificationCharge('x')).toBe(false);
	});

	it('refuses fractions, negatives and non-numbers', () => {
		for (const bad of [10000.5, '10000.50', 0.02, -1, '-5.00', 'abc', '', '1e3', Number.NaN, Infinity]) {
			expect(() => toMnt(bad as number | string)).toThrow(MoneyError);
		}
	});
});

describe('isValidAmount', () => {
	it('accepts positive integers up to the cap', () => {
		expect(isValidAmount(1)).toBe(true);
		expect(isValidAmount(1_000_000_000)).toBe(true);
		expect(isValidAmount(0)).toBe(false);
		expect(isValidAmount(-5)).toBe(false);
		expect(isValidAmount(1.5)).toBe(false);
		expect(isValidAmount('100')).toBe(false);
		expect(isValidAmount(1_000_000_001)).toBe(false);
	});
});

it('formatMnt', () => {
	expect(formatMnt(49900)).toBe('₮49,900');
});
