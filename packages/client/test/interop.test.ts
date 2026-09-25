import { describe, expect, it } from 'vitest';
import { signPayload } from '../../../apps/gateway/src/lib/server/events/deliver';
import { verifyWebhook } from '../src/index';

describe('gateway signing ↔ client verification', () => {
	it('verifies what the gateway signs and rejects a tampered body', async () => {
		const body = JSON.stringify({ id: 'x', object: 'event', type: 'invoice.paid', createdAt: '', data: {} });
		const header = await signPayload('bgwh_secret', Math.floor(Date.now() / 1000), body);
		await expect(verifyWebhook(body, header, 'bgwh_secret')).resolves.toMatchObject({ id: 'x' });
		await expect(verifyWebhook(body + ' ', header, 'bgwh_secret')).rejects.toThrow();
	});
});
