import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BogtsSignatureError, constructEvent, verifyWebhook } from '../src/index.js';

const SECRET = 'bgwh_0123456789abcdefghijABCDEFGHIJKL';
const NOW = 1_790_000_000;
const body = JSON.stringify({
	id: '01K5ZABCDEFGHJKMNPQRSTVWXY',
	object: 'event',
	type: 'invoice.paid',
	createdAt: '2026-09-25T10:00:00.000Z',
	data: { invoiceId: 'inv_1', provider: 'qpay', reference: 'order-42', amount: 10000, currency: 'MNT' }
});
const sign = (t: number, b = body, secret = SECRET) => createHmac('sha256', secret).update(`${t}.${b}`).digest('hex');
const header = (t = NOW, b = body, secret = SECRET) => `t=${t},v1=${sign(t, b, secret)}`;

async function reason(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (err) {
		expect(err).toBeInstanceOf(BogtsSignatureError);
		return (err as BogtsSignatureError).reason;
	}
	throw new Error('expected a BogtsSignatureError');
}

describe('verifyWebhook', () => {
	it('accepts a valid signature and returns the typed event', async () => {
		const event = await verifyWebhook(body, header(), SECRET, { now: NOW });
		expect(event.id).toBe('01K5ZABCDEFGHJKMNPQRSTVWXY');
		if (event.type === 'invoice.paid') expect(event.data.invoiceId).toBe('inv_1');
		else throw new Error('narrowing');
	});

	it('accepts bytes as well as text', async () => {
		const bytes = new TextEncoder().encode(body);
		await expect(verifyWebhook(bytes, header(), SECRET, { now: NOW })).resolves.toMatchObject({ type: 'invoice.paid' });
		await expect(verifyWebhook(bytes.buffer, header(), SECRET, { now: NOW })).resolves.toBeTruthy();
	});

	it('rejects a tampered body', async () => {
		expect(await reason(verifyWebhook(body.replace('10000', '1'), header(), SECRET, { now: NOW }))).toBe('mismatch');
	});

	it('rejects the wrong secret', async () => {
		expect(await reason(verifyWebhook(body, header(), 'bgwh_other', { now: NOW }))).toBe('mismatch');
	});

	it('rejects a tampered timestamp (the timestamp is signed)', async () => {
		const h = `t=${NOW + 1},v1=${sign(NOW)}`;
		expect(await reason(verifyWebhook(body, h, SECRET, { now: NOW }))).toBe('mismatch');
	});

	it('rejects an expired timestamp, and one from the future', async () => {
		expect(await reason(verifyWebhook(body, header(NOW - 301), SECRET, { now: NOW }))).toBe('timestamp_out_of_tolerance');
		expect(await reason(verifyWebhook(body, header(NOW + 301), SECRET, { now: NOW }))).toBe('timestamp_out_of_tolerance');
		await expect(verifyWebhook(body, header(NOW - 300), SECRET, { now: NOW })).resolves.toBeTruthy();
		await expect(verifyWebhook(body, header(NOW - 1000), SECRET, { now: NOW, toleranceSec: 3600 })).resolves.toBeTruthy();
	});

	it('accepts when any of several v1 values matches', async () => {
		const h = `t=${NOW},v1=${'0'.repeat(64)},v1=${sign(NOW)},v0=ignored`;
		await expect(verifyWebhook(body, h, SECRET, { now: NOW })).resolves.toBeTruthy();
		const none = `t=${NOW},v1=${'0'.repeat(64)},v1=${'f'.repeat(64)}`;
		expect(await reason(verifyWebhook(body, none, SECRET, { now: NOW }))).toBe('mismatch');
	});

	it('accepts any of several secrets (rotation)', async () => {
		await expect(verifyWebhook(body, header(), ['bgwh_new', SECRET], { now: NOW })).resolves.toBeTruthy();
	});

	it('rejects missing and malformed headers', async () => {
		expect(await reason(verifyWebhook(body, null, SECRET, { now: NOW }))).toBe('missing_header');
		expect(await reason(verifyWebhook(body, `v1=${sign(NOW)}`, SECRET, { now: NOW }))).toBe('malformed_header');
		expect(await reason(verifyWebhook(body, `t=abc,v1=${sign(NOW)}`, SECRET, { now: NOW }))).toBe('malformed_header');
		expect(await reason(verifyWebhook(body, `t=${NOW},t=${NOW},v1=${sign(NOW)}`, SECRET, { now: NOW }))).toBe('malformed_header');
		expect(await reason(verifyWebhook(body, `t=${NOW}`, SECRET, { now: NOW }))).toBe('no_signature');
	});

	it('rejects a signed body that is not JSON', async () => {
		expect(await reason(verifyWebhook('nope', header(NOW, 'nope'), SECRET, { now: NOW }))).toBe('invalid_payload');
	});
});

describe('constructEvent', () => {
	it('reads the raw body and header from a Request', async () => {
		const request = new Request('https://project.test/webhooks/bogts', {
			method: 'POST',
			headers: { 'Bogts-Signature': header(), 'content-type': 'application/json' },
			body
		});
		await expect(constructEvent(request, SECRET, { now: NOW })).resolves.toMatchObject({ type: 'invoice.paid' });
	});
});
