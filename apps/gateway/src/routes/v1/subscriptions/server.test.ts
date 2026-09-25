import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBonumTokenCache } from '$lib/server/providers/bonum/client';
import { fakeBonum, jsonResponse } from '$lib/server/providers/bonum/testing';
import { createTestDb, seedPlan, seedProject, testConfig, type TestDb } from '$lib/server/testdb';
import { GET, POST } from './+server';

let db: TestDb;
let apiKey: string;

beforeEach(async () => {
	db = createTestDb();
	const seeded = await seedProject(db);
	apiKey = seeded.apiKey;
	await seedPlan(db, seeded.project.id, { key: 'pro-monthly', providerPlanId: 166, amount: 49_900 });
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

function call(handler: unknown, method: string, body?: unknown, headers: Record<string, string> = {}, search = '') {
	const url = new URL(`https://payments.test/v1/subscriptions${search}`);
	const request = new Request(url, {
		method,
		headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	const event = { request, url, params: {}, locals: { db, config: testConfig(), waitUntil: () => {} } };
	return (handler as (e: RequestEvent) => Promise<Response>)(event as unknown as RequestEvent);
}

describe('/v1/subscriptions', () => {
	it('POST creates (201) and an Idempotency-Key replays the first answer', async () => {
		const bonum = fakeBonum({
			'GET /mpay-service/merchant/values/payment-plans': () =>
				jsonResponse({ data: [{ planId: 166, name: 'Pro', recurringType: 'MONTHLY', amount: 49900.0, status: 'ACTIVE' }] }),
			'POST /mpay-service/merchant/cards/tokenize/request': () =>
				jsonResponse({ followUpLink: 'https://ecommerce.bonum.mn/tokenize?id=1', id: '1' })
		});
		const input = { plan: 'pro-monthly', customerRef: 'shop-1', returnUrl: 'https://project.test/done' };
		const first = await call(POST, 'POST', input, { 'idempotency-key': 'k1' });
		expect(first.status).toBe(201);
		const body = (await first.json()) as { id: string; redirectUrl: string; object: string };
		expect(body).toMatchObject({ object: 'subscription', redirectUrl: 'https://ecommerce.bonum.mn/tokenize?id=1' });
		const replay = await call(POST, 'POST', input, { 'idempotency-key': 'k1' });
		expect(replay.headers.get('idempotent-replayed')).toBe('true');
		expect(((await replay.json()) as { id: string }).id).toBe(body.id);
		expect(bonum.count('POST /mpay-service/merchant/cards/tokenize/request')).toBe(1);

		const list = await call(GET, 'GET', undefined, {}, '?limit=5');
		expect(await list.json()).toMatchObject({ object: 'list', hasMore: false, nextCursor: null, data: [{ id: body.id }] });
	});

	it('validates input and auth', async () => {
		const bad = await call(POST, 'POST', { plan: 'pro-monthly', customerRef: 'x', returnUrl: 'http://evil.example' });
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('invalid_request');
		apiKey = 'bgk_' + 'x'.repeat(32);
		expect((await call(GET, 'GET')).status).toBe(401);
	});
});
