import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encrypt } from '../../crypto';
import { providerToken } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createTestDb, TEST_ENCRYPTION_KEY, testConfig, type TestDb } from '../../testdb';
import { accessToken, BonumError, bonumCall, bonumRequest, resetBonumTokenCache, tokenStoreKey } from './client';
import { AUTH_CREATE, AUTH_REFRESH, fakeBonum, jsonResponse } from './testing';

let db: TestDb;
let ctx: ServiceContext;
const PLANS = 'GET /mpay-service/merchant/values/payment-plans';
const plansPath = '/mpay-service/merchant/values/payment-plans';

beforeEach(() => {
	db = createTestDb();
	ctx = { db, config: testConfig(), now: 1_000_000 };
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('access token cache', () => {
	it('mints once, then reuses memory; Accept-Language on every request', async () => {
		const bonum = fakeBonum({ [PLANS]: () => jsonResponse({ data: [] }) });
		await bonumRequest(ctx, 'plans', plansPath);
		await bonumRequest(ctx, 'plans', plansPath);
		expect(bonum.count(AUTH_CREATE)).toBe(1);
		const [create] = bonum.to(AUTH_CREATE);
		expect(create!.headers.get('authorization')).toBe('AppSecret test-app-secret');
		expect(create!.headers.get('x-terminal-id')).toBe('test-terminal');
		for (const call of bonum.calls) expect(call.headers.get('accept-language')).toBe('mn');
		expect(bonum.to(PLANS)[1]!.headers.get('authorization')).toBe('Bearer tok-1');
	});

	it('a second isolate reuses the token from D1 without minting', async () => {
		const bonum = fakeBonum();
		expect(await accessToken(ctx)).toBe('tok-1');
		resetBonumTokenCache(); // a new isolate: empty memory, same D1
		expect(await accessToken(ctx)).toBe('tok-1');
		expect(bonum.count(AUTH_CREATE)).toBe(1);
	});

	it('stores tokens encrypted, under a key with no secret in it', async () => {
		fakeBonum();
		await accessToken(ctx);
		const rows = await db.select().from(providerToken);
		expect(rows).toHaveLength(1);
		const key = await tokenStoreKey(ctx.config.bonum!);
		expect(rows[0]!.key).toBe(key);
		expect(key).not.toContain('test-app-secret');
		expect(rows[0]!.accessTokenEnc).not.toContain('tok-1');
		expect(rows[0]!.refreshTokenEnc).not.toContain('ref-1');
	});

	it('concurrent callers in one isolate share one mint', async () => {
		const bonum = fakeBonum();
		const tokens = await Promise.all([accessToken(ctx), accessToken(ctx), accessToken(ctx)]);
		expect(new Set(tokens)).toEqual(new Set(['tok-1']));
		expect(bonum.count(AUTH_CREATE)).toBe(1);
	});

	it('refreshes an expired token instead of minting', async () => {
		const bonum = fakeBonum({
			[AUTH_REFRESH]: () =>
				jsonResponse({ accessToken: 'tok-refreshed', refreshToken: 'ref-2', expiresIn: 1800, refreshExpiresIn: 2000 })
		});
		await accessToken(ctx);
		ctx.now = 1_000_000 + 1800 * 1000; // past the access token, within the refresh token
		expect(await accessToken(ctx)).toBe('tok-refreshed');
		expect(bonum.count(AUTH_CREATE)).toBe(1);
		expect(bonum.to(AUTH_REFRESH)[0]!.headers.get('authorization')).toBe('Bearer ref-1');
	});

	it('a 401 mints once and retries once with the new token', async () => {
		const bonum = fakeBonum({
			[PLANS]: (call) =>
				call.headers.get('authorization') === 'Bearer tok-1' ? jsonResponse({}, 401) : jsonResponse({ data: [] })
		});
		await bonumRequest(ctx, 'plans', plansPath);
		expect(bonum.count(AUTH_CREATE)).toBe(2);
		expect(bonum.count(PLANS)).toBe(2);
		expect(bonum.count(AUTH_REFRESH)).toBe(0);
	});

	it('a second 401 is an error, not a loop', async () => {
		const bonum = fakeBonum({ [PLANS]: () => jsonResponse({}, 401) });
		await expect(bonumRequest(ctx, 'plans', plansPath)).rejects.toMatchObject({ status: 401 });
		expect(bonum.count(PLANS)).toBe(2);
		expect(bonum.count(AUTH_CREATE)).toBe(2);
	});

	it('on a 401, a different fresh token stored by another isolate wins over minting', async () => {
		const bonum = fakeBonum({
			[PLANS]: (call) =>
				call.headers.get('authorization') === 'Bearer tok-1' ? jsonResponse({}, 401) : jsonResponse({ data: [] })
		});
		await accessToken(ctx); // this isolate holds tok-1 in memory
		// Meanwhile another isolate replaced the shared token.
		await db.update(providerToken).set({ accessTokenEnc: await encrypt('tok-other', TEST_ENCRYPTION_KEY) });
		await bonumRequest(ctx, 'plans', plansPath);
		expect(bonum.count(AUTH_CREATE)).toBe(1);
		expect(bonum.to(PLANS).map((c) => c.headers.get('authorization'))).toEqual(['Bearer tok-1', 'Bearer tok-other']);
	});

	it('a rate-limited mint falls back to a token another isolate just stored', async () => {
		fakeBonum();
		await accessToken(ctx); // tok-1 in memory and D1
		const bonum = fakeBonum({
			[AUTH_CREATE]: async () => {
				// Another isolate won the race and stored its token.
				await db.update(providerToken).set({ accessTokenEnc: await encrypt('tok-other', TEST_ENCRYPTION_KEY) });
				return jsonResponse({ message: 'Rate-Limit: Use previous token. Do not get token too frequently,', status: 429 }, 429);
			}
		});
		expect(await accessToken(ctx, 'tok-1')).toBe('tok-other');
		expect(bonum.count(AUTH_CREATE)).toBe(1);
	});

	it('a rate-limited mint with nothing stored is a safe BonumError', async () => {
		fakeBonum({ [AUTH_CREATE]: () => jsonResponse({ message: 'Rate-Limit: Use previous token.' }, 429) });
		const err = await accessToken(ctx).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BonumError);
		expect((err as BonumError).code).toBe('rate_limited');
		expect((err as BonumError).message).not.toContain('Use previous token');
	});
});

describe('requests', () => {
	it('never carries provider free text or errorCode in errors', async () => {
		fakeBonum({
			[PLANS]: () =>
				jsonResponse({ errorCode: '${invalid.bonum.response.56}', message: 'Картаар төлбөр хийх боломжгүй (56)' }, 400)
		});
		const err = (await bonumRequest(ctx, 'plans', plansPath).catch((e: unknown) => e)) as BonumError;
		expect(err).toBeInstanceOf(BonumError);
		expect(err.code).toBe('http_400');
		expect(err.message).not.toContain('56');
	});

	it('keeps a dotted message key as the code', async () => {
		fakeBonum({ [PLANS]: () => jsonResponse({ message: 'subscription.process.waiting', status: 429 }, 429) });
		const err = (await bonumRequest(ctx, 'plans', plansPath).catch((e: unknown) => e)) as BonumError;
		expect(err.code).toBe('subscription.process.waiting');
	});

	it('maps a timeout to a BonumError', async () => {
		fakeBonum({
			[PLANS]: () => {
				throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
			}
		});
		const err = (await bonumCall(ctx, 'plans', plansPath).catch((e: unknown) => e)) as BonumError;
		expect(err).toBeInstanceOf(BonumError);
		expect(err.code).toBe('timeout');
		expect(err.operation).toBe('plans');
	});

	it('sends X-CARD-TOKEN and a JSON body when asked', async () => {
		const bonum = fakeBonum({ 'POST /x': () => jsonResponse({ ok: true }) });
		await bonumRequest(ctx, 'x', '/x', { method: 'POST', body: { a: 1 }, cardToken: 'card-secret' });
		const [call] = bonum.to('POST /x');
		expect(call!.headers.get('x-card-token')).toBe('card-secret');
		expect(call!.headers.get('content-type')).toBe('application/json');
		expect(call!.body).toEqual({ a: 1 });
	});

	it('refuses when Bonum is off', async () => {
		ctx.config = testConfig({ bonum: null, providers: { bonum: false, qpay: true } });
		await expect(accessToken(ctx)).rejects.toMatchObject({ code: 'provider_disabled' });
	});
});
