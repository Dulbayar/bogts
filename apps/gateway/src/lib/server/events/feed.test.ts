import { ulid } from 'ulid';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { event } from '../schema';
import { createTestDb, seedProject, type TestDb } from '../testdb';
import { FEED_STABILITY_MS, getEvent, listEvents, parseFeedQuery } from './feed';
import type { EventType } from './emit';

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const q = (s = '') => parseFeedQuery(new URLSearchParams(s));

/** Inserts events minted at the given times (ids carry the time, as newId() does). */
async function insertEvents(db: TestDb, projectId: string, times: number[], type: EventType = 'invoice.paid') {
	const ids: string[] = [];
	for (const t of times) {
		const id = ulid(t);
		ids.push(id);
		await db.insert(event).values({ id, projectId, type, subjectId: 'inv', data: { invoiceId: 'inv', paidAt: t }, createdAt: t });
	}
	return ids;
}

async function setup() {
	const db = createTestDb();
	const { project: p } = await seedProject(db);
	const { project: other } = await seedProject(db, { name: 'Other' });
	// 7 settled events, one per minute, oldest first.
	const ids = await insertEvents(db, p.id, [7, 6, 5, 4, 3, 2, 1].map((m) => NOW - m * 60_000));
	await insertEvents(db, other.id, [NOW - 30_000]);
	return { db, p, other, ids };
}

describe('GET /v1/events feed', () => {
	it('newest first, paged with cursor', async () => {
		const { db, p, ids } = await setup();
		const seen: string[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page = await listEvents(db, p.id, q(`limit=3${cursor ? `&cursor=${cursor}` : ''}`), NOW);
			expect(page.object).toBe('list');
			seen.push(...page.data.map((e) => e.id));
			expect(page.hasMore).toBe(page.nextCursor !== null);
			cursor = page.nextCursor;
			pages++;
		} while (cursor);
		expect(pages).toBe(3);
		expect(seen).toEqual([...ids].reverse());
	});

	it('a lowercased cursor continues correctly', async () => {
		const { db, p, ids } = await setup();
		const first = await listEvents(db, p.id, q('limit=3'), NOW);
		const next = await listEvents(db, p.id, q(`limit=3&cursor=${first.nextCursor!.toLowerCase()}`), NOW);
		expect(next.data.map((e) => e.id)).toEqual([...ids].reverse().slice(3, 6));
	});

	it('oldest first from ?after, and an empty after starts at the beginning', async () => {
		const { db, p, ids } = await setup();
		const first = await listEvents(db, p.id, q('after=&limit=4'), NOW);
		expect(first.data.map((e) => e.id)).toEqual(ids.slice(0, 4));
		expect(first).toMatchObject({ hasMore: true, nextCursor: ids[3] });
		const rest = await listEvents(db, p.id, q(`after=${first.nextCursor}&limit=4`), NOW);
		expect(rest.data.map((e) => e.id)).toEqual(ids.slice(4));
		expect(rest).toMatchObject({ hasMore: false, nextCursor: null });
		expect((await listEvents(db, p.id, q(`after=${ids[6]}`), NOW)).data).toEqual([]);
	});

	it('items are public events with ISO timestamps', async () => {
		const { db, p, ids } = await setup();
		const page = await listEvents(db, p.id, q('limit=1'), NOW);
		expect(page.data[0]).toEqual({
			id: ids[6],
			object: 'event',
			type: 'invoice.paid',
			createdAt: new Date(NOW - 60_000).toISOString(),
			data: { invoiceId: 'inv', paidAt: new Date(NOW - 60_000).toISOString() }
		});
	});

	it('holds back events younger than the stability cutoff', async () => {
		const { db, p, ids } = await setup();
		const [young] = await insertEvents(db, p.id, [NOW - FEED_STABILITY_MS + 1]);
		const [settled] = await insertEvents(db, p.id, [NOW - FEED_STABILITY_MS - 1]);
		const asc = await listEvents(db, p.id, q(`after=${ids[6]}`), NOW);
		expect(asc.data.map((e) => e.id)).toEqual([settled]);
		const desc = await listEvents(db, p.id, q(), NOW);
		expect(desc.data.map((e) => e.id)).not.toContain(young);
		// Five seconds later it appears.
		expect((await listEvents(db, p.id, q(`after=${settled}`), NOW + FEED_STABILITY_MS)).data.map((e) => e.id)).toEqual([young]);
		// A single event has no cutoff.
		expect((await getEvent(db, p.id, young!)).id).toBe(young);
	});

	it('only the caller project’s events', async () => {
		const { db, p, other, ids } = await setup();
		expect((await listEvents(db, other.id, q(), NOW)).data).toHaveLength(1);
		await expect(getEvent(db, other.id, ids[0]!)).rejects.toMatchObject({ status: 404 });
		await expect(getEvent(db, p.id, 'not-an-id')).rejects.toMatchObject({ status: 404 });
		expect((await getEvent(db, p.id, ids[0]!.toLowerCase())).id).toBe(ids[0]);
	});

	it('filters by type', async () => {
		const { db, p } = await setup();
		const [failed] = await insertEvents(db, p.id, [NOW - 10 * 60_000], 'charge.failed');
		expect((await listEvents(db, p.id, q('type=charge.failed,charge.reversed'), NOW)).data.map((e) => e.id)).toEqual([failed]);
	});

	it('rejects bad parameters with 400', () => {
		for (const s of ['limit=0', 'limit=101', 'limit=x', 'after=nope', 'cursor=nope', `after=&cursor=${ulid()}`, 'type=invoice.nope']) {
			const err = (() => {
				try {
					q(s);
				} catch (e) {
					return e;
				}
			})();
			expect(err, s).toBeInstanceOf(ApiError);
			expect(err, s).toMatchObject({ status: 400, code: 'invalid_request' });
		}
		expect(q()).toMatchObject({ limit: 20 });
		expect(q('limit=100')).toMatchObject({ limit: 100 });
	});
});
