/**
 * Money is integer MNT everywhere at the API and in the database.
 *
 * Providers send decimals (`10000.00`, or `5.00` in a CARD-TOKEN webhook).
 * `toMnt` turns those into integers and refuses anything that is not a whole
 * number of tugrik, except Bonum's 0.01 MNT card-verification charge (a card
 * replacement with no amount), which is not money and comes back as 0.
 */

export class MoneyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MoneyError';
	}
}

/** Bonum's card-verification charge: it only checks the card. */
export const VERIFICATION_CHARGE = 0.01;

/** The largest amount the API accepts: ₮1,000,000,000. */
export const MAX_AMOUNT = 1_000_000_000;

const EPSILON = 1e-6;

function parse(value: number | string): number {
	const n = typeof value === 'number' ? value : /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : Number.NaN;
	if (!Number.isFinite(n)) throw new MoneyError('amount is not a number');
	return n;
}

/** True for the 0.01 MNT card-verification charge (as a number or as text like "0.01"). */
export function isVerificationCharge(value: number | string): boolean {
	try {
		return Math.abs(parse(value) - VERIFICATION_CHARGE) < EPSILON;
	} catch {
		return false;
	}
}

/**
 * A provider amount as integer MNT: `10000.00` → 10000, `"10000.00"` → 10000,
 * 0.01 → 0 (verification only). Throws `MoneyError` on a fraction, a negative
 * amount or a non-number.
 */
export function toMnt(providerAmount: number | string): number {
	const n = parse(providerAmount);
	if (n < 0) throw new MoneyError('amount is negative');
	if (Math.abs(n - VERIFICATION_CHARGE) < EPSILON) return 0;
	const rounded = Math.round(n);
	if (Math.abs(n - rounded) > EPSILON) throw new MoneyError('amount has a fraction of a tugrik');
	if (!Number.isSafeInteger(rounded)) throw new MoneyError('amount is out of range');
	return rounded;
}

/** An amount a project sent: a positive integer MNT no larger than MAX_AMOUNT. */
export function isValidAmount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT;
}

/** For the dashboard: `₮10,000`. */
export function formatMnt(amount: number): string {
	return `₮${amount.toLocaleString('en-US')}`;
}
