import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { providerToken } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createTestDb, testConfig, type TestDb } from '../../testdb';
import { QpayCallError, qpayCall, resetQpayTokenCache } from './client';
import { fakeQpay, type FakeQpay } from './fake';

let db: TestDb;
let ctx: ServiceContext;
let qpay: FakeQpay;

const check = (c: ServiceContext) =>
	qpayCall(c, 'payment/check', (client) => client.checkPayment({ objectType: 'INVOICE', objectId: 'x' }));

beforeEach(() => {
	resetQpayTokenCache();
	db = createTestDb();
	ctx = { db, config: testConfig() };
	qpay = fakeQpay();
	vi.stubGlobal('fetch', qpay.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('qpayCall tokens', () => {
	it('mints once and reuses the token from memory', async () => {
		await check(ctx);
		await check(ctx);
		expect(qpay.mints).toBe(1);
		expect(qpay.count('POST /v2/payment/check')).toBe(2);
	});

	it('shares the token across isolates through D1, encrypted', async () => {
		await check(ctx);
		const [row] = await db.select().from(providerToken);
		expect(row?.key).toMatch(/^qpay:[0-9a-f]{64}$/);
		expect(row?.accessTokenEnc).toMatch(/^v1\./);
		expect(row?.accessTokenEnc).not.toContain('at-mint-1');
		expect(row?.refreshTokenEnc).not.toContain('rt-mint-1');
		expect(row?.expiresAt).toBeGreaterThan(Date.now());

		resetQpayTokenCache(); // a cold isolate
		await check(ctx);
		expect(qpay.mints).toBe(1);
	});

	it('refreshes an expired token instead of minting', async () => {
		await check(ctx);
		await db.update(providerToken).set({ expiresAt: Date.now() - 1000 });
		resetQpayTokenCache();
		await check(ctx);
		expect(qpay.mints).toBe(1);
		expect(qpay.refreshes).toBe(1);
	});

	it('on a 401 drops the token, gets a new one and retries once', async () => {
		await check(ctx);
		qpay.revoked.add('at-mint-1');
		await check(ctx);
		expect(qpay.count('POST /v2/payment/check')).toBe(3);
		expect(qpay.mints + qpay.refreshes).toBe(2);
	});

	it('does not loop on a persistent 401', async () => {
		qpay.failures.set('POST /v2/payment/check', { status: 401 });
		await expect(check(ctx)).rejects.toMatchObject({ status: 401 });
		expect(qpay.count('POST /v2/payment/check')).toBe(2);
	});
});

describe('qpayCall errors', () => {
	it('carries status, a safe code and the operation, never the body', async () => {
		qpay.failures.set('POST /v2/payment/check', { status: 500 });
		const err = await check(ctx).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(QpayCallError);
		expect(err).toMatchObject({ status: 500, operation: 'payment/check' });
		expect(String((err as Error).message)).not.toContain('secret upstream body');
		expect((err as QpayCallError).code).toMatch(/^[A-Za-z0-9_]+$/);
	});

	it('keeps QPay error codes', async () => {
		qpay.failures.set('POST /v2/payment/check', {
			status: 400,
			body: JSON.stringify({ error: 'INVOICE_NOTFOUND', message: 'x' })
		});
		await expect(check(ctx)).rejects.toMatchObject({ status: 400, code: 'INVOICE_NOTFOUND' });
	});

	it('reports a failed mint as auth/token without the password', async () => {
		ctx = { db, config: testConfig({ qpay: { ...testConfig().qpay!, clientPassword: 'wrong-password' } }) };
		const err = (await check(ctx).catch((e: unknown) => e)) as QpayCallError;
		expect(err).toMatchObject({ status: 401, operation: 'auth/token' });
		expect(err.message).not.toContain('wrong-password');
	});

	it('network failures become network_error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('fetch failed: secret');
			})
		);
		await expect(check(ctx)).rejects.toMatchObject({ status: 0, code: 'network_error' });
	});

	it('refuses when QPay is not configured', async () => {
		ctx = { db, config: testConfig({ qpay: null, providers: { bonum: true, qpay: false } }) };
		await expect(check(ctx)).rejects.toMatchObject({ code: 'not_configured' });
		expect(qpay.calls).toHaveLength(0);
	});
});
