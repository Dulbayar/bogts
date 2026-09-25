import { ulid } from 'ulid';
import { describe, expect, it } from 'vitest';
import { event } from '$lib/server/schema';
import { createTestDb, seedProject } from '$lib/server/testdb';
import { GET as list } from './+server';
import { GET as get } from './[id]/+server';

async function setup() {
	const db = createTestDb();
	const { project: p, apiKey } = await seedProject(db);
	const id = ulid(Date.now() - 60_000);
	await db.insert(event).values({ id, projectId: p.id, type: 'invoice.paid', subjectId: 'inv', data: {}, createdAt: Date.now() - 60_000 });
	return { db, apiKey, id };
}

const call = async <H extends (e: never) => Response | Promise<Response>>(handler: H, path: string, db: unknown, apiKey?: string, params = {}) => {
	const url = new URL(`https://payments.test${path}`);
	const request = new Request(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
	return handler({ request, url, params, locals: { db } } as never);
};

describe('/v1/events routes', () => {
	it('lists and gets with a project key', async () => {
		const { db, apiKey, id } = await setup();
		const res = await call(list, '/v1/events?after=', db, apiKey);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ object: 'list', data: [{ id, object: 'event' }], hasMore: false, nextCursor: null });
		const one = await call(get, `/v1/events/${id}`, db, apiKey, { id });
		expect(one.status).toBe(200);
		expect(await one.json()).toMatchObject({ id, type: 'invoice.paid' });
	});

	it('401 without a key, 400 on a bad query, 404 on an unknown id', async () => {
		const { db, apiKey } = await setup();
		expect((await call(list, '/v1/events', db)).status).toBe(401);
		const bad = await call(list, '/v1/events?limit=500', db, apiKey);
		expect(bad.status).toBe(400);
		expect(await bad.json()).toMatchObject({ error: { code: 'invalid_request' } });
		expect((await call(get, '/v1/events/x', db, apiKey, { id: 'x' })).status).toBe(404);
	});
});
