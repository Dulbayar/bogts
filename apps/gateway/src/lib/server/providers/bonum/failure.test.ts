import { describe, expect, it } from 'vitest';
import { describeFailure, describeResponseCode, failureCodes, withFailure } from './failure';
import { docJson, PAYMENT_FAILED, PAYMENT_FAILED_CARD_ASSUMED, PAYMENT_SUCCESS } from './fixtures';

const bodyOf = (text: string) => (JSON.parse(docJson(text)) as { body: Record<string, unknown> }).body;

describe('Bonum failure codes', () => {
	it('reads the card decline: status, bank code with its meaning, vendor', () => {
		const body = bodyOf(PAYMENT_FAILED_CARD_ASSUMED);
		expect(failureCodes(body)).toEqual({ statuses: ['ERROR'], respCode: '51', paymentVendor: 'E_COMMERCE' });
		expect(describeFailure(body)).toBe('Bonum: ERROR, bank code 51 (insufficient funds), card');
	});

	it('reads the expired sample', () => {
		expect(describeFailure(bodyOf(PAYMENT_FAILED))).toBe('Bonum: EXPIRED');
		expect(describeFailure({ ...bodyOf(PAYMENT_FAILED), invoiceStatus: 'CANCELLED' })).toBe('Bonum: CANCELLED');
	});

	it('ignores an empty respCode (the success sample)', () => {
		expect(failureCodes(bodyOf(PAYMENT_SUCCESS)).respCode).toBeNull();
	});

	it('shows an unknown code as just the number', () => {
		expect(describeResponseCode('07')).toBe('bank code 07');
		expect(describeResponseCode('05')).toBe('bank code 05 (do not honor)');
		expect(describeFailure({ respCode: 5 })).toBe('Bonum: bank code 05 (do not honor)');
	});

	it('lets only allowlisted shapes through, never free text', () => {
		const body = {
			status: 'Insufficient funds, call your bank',
			invoiceStatus: 'FAILED',
			cardStatus: 'INACTIVE',
			respCode: '51; drop table',
			paymentVendor: 'E-COMMERCE <b>',
			message: 'Үлдэгдэл хүрэлцэхгүй'
		};
		expect(failureCodes(body)).toEqual({ statuses: ['FAILED', 'INACTIVE'], respCode: null, paymentVendor: null });
		expect(describeFailure({ respCode: '1234' })).toBe('');
		expect(describeFailure({ status: 'FAILED', invoiceStatus: 'FAILED' })).toBe('Bonum: FAILED');
	});

	it('appends the codes to a sentence only when there are any', () => {
		expect(withFailure('The queued card payment was declined', {})).toBe('The queued card payment was declined');
		expect(withFailure('The queued card payment was declined', { respCode: '51' })).toBe(
			'The queued card payment was declined. Bonum: bank code 51 (insufficient funds)'
		);
	});
});
