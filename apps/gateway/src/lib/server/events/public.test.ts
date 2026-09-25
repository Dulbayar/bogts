import { expect, it } from 'vitest';
import { eventJson, isoEventData } from './public';

const T = Date.UTC(2026, 8, 25, 12, 0, 0);
const iso = new Date(T).toISOString();

it('eventJson is the public shape, with ISO timestamps', () => {
	expect(
		eventJson({ id: '01K', type: 'invoice.paid', createdAt: T, data: { invoiceId: 'inv', amount: 5, paidAt: T, metadata: { a: '1' } } })
	).toEqual({ id: '01K', object: 'event', type: 'invoice.paid', createdAt: iso, data: { invoiceId: 'inv', amount: 5, paidAt: iso, metadata: { a: '1' } } });
});

it('converts *At numbers and period, and leaves everything else', () => {
	expect(
		isoEventData({ nextBillAt: T, cancelledAt: null, period: { start: T, end: T }, amount: T, reference: 'r', chargedAt: 'x' })
	).toEqual({ nextBillAt: iso, cancelledAt: null, period: { start: iso, end: iso }, amount: T, reference: 'r', chargedAt: 'x' });
});
