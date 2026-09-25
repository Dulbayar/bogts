import { describe, expect, it, vi } from 'vitest';
import { ApiError, json } from './api/errors';
import { IDEMPOTENCY_STALE_MS, IDEMPOTENCY_TTL_MS, idempotencyKey, idempotent, purgeIdempotency } from './idempotency';
import { idempotency } from './schema';
import { createTestDb, seedProject, type TestDb } from './testdb';

const NOW = 1_800_000_000_000;

async function setup() {
	const db = createTestDb();
	const { project } = await seedProject(db);
	const input = (over: Partial<Parameters<typeof idempotent>[1]> = {}) => ({
		projectId: project.id,
		key: 'key-1',
		method: 'POST',
		path: '/v1/invoices',
		body: '{"amount":1000}',
		now: NOW,
		...over
	});
	return { db, project, input };
}

async function errorOf(p: Promise<unknown>): Promise<ApiError> {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ApiError);
	return err as ApiError;
}

describe('idempotent', () => {
	it('without a key, just runs', async () => {
		const { db, input } = await setup();
		const run = vi.fn(async () => json({ id: 'a' }, 201));
		await idempotent(db, input({ key: null }), run);
		await idempotent(db, input({ key: null }), run);
		expect(run).toHaveBeenCalledTimes(2);
		expect(await db.select().from(idempotency)).toHaveLength(0);
	});

	it('replays the first response for the same key and request', async () => {
		const { db, input } = await setup();
		const run = vi.fn(async () => json({ id: 'inv_1' }, 201));
		const first = await idempotent(db, input(), run);
		expect(first.status).toBe(201);
		expect(await first.json()).toEqual({ id: 'inv_1' });

		const second = await idempotent(db, input({ now: NOW + 1000 }), run);
		expect(run).toHaveBeenCalledTimes(1);
		expect(second.status).toBe(201);
		expect(second.headers.get('idempotent-replayed')).toBe('true');
		expect(await second.json()).toEqual({ id: 'inv_1' });
	});

	it('replays a 4xx too', async () => {
		const { db, input } = await setup();
		const run = vi.fn(async () => json({ error: { code: 'invalid_request', message: 'x' } }, 400));
		await idempotent(db, input(), run);
		const again = await idempotent(db, input(), run);
		expect(run).toHaveBeenCalledTimes(1);
		expect(again.status).toBe(400);
	});

	it('refuses the same key with a different request (422)', async () => {
		const { db, input } = await setup();
		await idempotent(db, input(), async () => json({ id: 'a' }, 201));
		const err = await errorOf(idempotent(db, input({ body: '{"amount":2000}' }), async () => json({}, 201)));
		expect(err.status).toBe(422);
		expect(err.code).toBe('idempotency_key_reused');
		const err2 = await errorOf(idempotent(db, input({ path: '/v1/charges' }), async () => json({}, 201)));
		expect(err2.code).toBe('idempotency_key_reused');
	});

	it('keys are per project', async () => {
		const { db, input } = await setup();
		const { project: other } = await seedProject(db);
		const run = vi.fn(async () => json({ ok: true }, 201));
		await idempotent(db, input(), run);
		await idempotent(db, input({ projectId: other.id }), run);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('409s while the first request is still running', async () => {
		const { db, input } = await setup();
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const first = idempotent(db, input(), async () => {
			await gate;
			return json({ id: 'a' }, 201);
		});
		await vi.waitFor(async () => expect(await db.select().from(idempotency)).toHaveLength(1));
		const err = await errorOf(idempotent(db, input(), async () => json({ id: 'b' }, 201)));
		expect(err.status).toBe(409);
		expect(err.code).toBe('idempotency_in_progress');
		release();
		expect((await first).status).toBe(201);
	});

	it('releases the key after an answered 5xx or a thrown 4xx, so a retry runs', async () => {
		const { db, input } = await setup();
		const failed = await idempotent(db, input(), async () => json({ error: {} }, 503));
		expect(failed.status).toBe(503);
		await expect(idempotent(db, input(), async () => Promise.reject(new ApiError(409, 'conflict', 'no')))).rejects.toThrow('no');
		const run = vi.fn(async () => json({ id: 'ok' }, 201));
		expect((await idempotent(db, input(), run)).status).toBe(201);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('stores a thrown 5xx ApiError or unexpected error and replays it without running again', async () => {
		const { db, input } = await setup();
		const unexpected = await idempotent(db, input(), async () => Promise.reject(new Error('D1_ERROR')));
		expect(unexpected.status).toBe(500);
		const run = vi.fn(async () => json({ id: 'ok' }, 201));
		const again = await idempotent(db, input(), run);
		expect(run).not.toHaveBeenCalled();
		expect(again.status).toBe(500);
		expect(again.headers.get('idempotent-replayed')).toBe('true');
		expect(await again.json()).toEqual({ error: { code: 'internal_error', message: 'Something went wrong. Try again.' } });

		const k2 = input({ key: 'key-2' });
		const provider = await idempotent(db, k2, async () => Promise.reject(new ApiError(502, 'provider_error', 'Bonum is down')));
		expect(provider.status).toBe(502);
		const replayed = await idempotent(db, k2, run);
		expect(run).not.toHaveBeenCalled();
		expect(await replayed.json()).toEqual({ error: { code: 'provider_error', message: 'Bonum is down' } });
	});

	it('takes over an abandoned claim and forgets keys after 24 h', async () => {
		const { db, input } = await setup();
		await (db as TestDb).insert(idempotency).values({
			projectId: input().projectId,
			key: 'key-1',
			requestHash: 'whatever',
			createdAt: NOW - IDEMPOTENCY_STALE_MS - 1
		});
		const run = vi.fn(async () => json({ id: 'fresh' }, 201));
		expect((await idempotent(db, input(), run)).status).toBe(201);
		expect(run).toHaveBeenCalledTimes(1);

		// 24 h later the same key runs again, even with a different body.
		const later = input({ now: NOW + IDEMPOTENCY_TTL_MS, body: '{"amount":5}' });
		expect((await idempotent(db, later, run)).status).toBe(201);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('purgeIdempotency drops keys older than 24 h', async () => {
		const { db, input } = await setup();
		await idempotent(db, input(), async () => json({}, 201));
		await idempotent(db, input({ key: 'key-2', now: NOW + IDEMPOTENCY_TTL_MS }), async () => json({}, 201));
		await purgeIdempotency(db, NOW + IDEMPOTENCY_TTL_MS + 1);
		const rows = await db.select().from(idempotency);
		expect(rows.map((r) => r.key)).toEqual(['key-2']);
	});
});

describe('idempotencyKey', () => {
	const req = (key?: string) =>
		new Request('https://payments.test/v1/invoices', { method: 'POST', headers: key === undefined ? {} : { 'idempotency-key': key } });

	it('reads the header', () => {
		expect(idempotencyKey(req())).toBeNull();
		expect(idempotencyKey(req('order-42:attempt-1'))).toBe('order-42:attempt-1');
	});

	it('refuses an over-long or non-ASCII key', () => {
		expect(() => idempotencyKey(req('x'.repeat(256)))).toThrow(ApiError);
		expect(() => idempotencyKey(req('has space'))).toThrow(ApiError);
	});
});
