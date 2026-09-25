/**
 * The project's event feed: `GET /v1/events` and `GET /v1/events/:id`.
 *
 * Two orders:
 *  - **Newest first** (default): `?cursor=<nextCursor>` pages backwards.
 *  - **Oldest first** from an id: `?after=<event id>` (an empty `after=` starts
 *    at the beginning). This is the reconciliation feed: a project stores the
 *    last id it processed and asks for what came after.
 *
 * **Stability cutoff:** the feed never returns events minted less than
 * `FEED_STABILITY_MS` ago. Ids are ULIDs minted per isolate, so two isolates
 * writing at the same time can commit ids out of order; without the cutoff a
 * client paging with `?after=` could skip an event committed just after it
 * read past that id. The cutoff compares the id's own time prefix, which is
 * what the order is by. A single event (`GET /v1/events/:id`) has no cutoff.
 */
import { and, asc, desc, eq, gt, inArray, lt, type SQL } from 'drizzle-orm';
import { encodeTime } from 'ulid';
import { z } from 'zod';
import { ApiError, describeZodError, notFound } from '../api/errors';
import type { DB } from '../db';
import { event } from '../schema';
import { cursorSchema } from '../services/paging';
import { EVENT_TYPES } from './emit';
import { eventJson, type EventJson } from './public';

export const FEED_STABILITY_MS = 5_000;
export const FEED_DEFAULT_LIMIT = 20;
export const FEED_MAX_LIMIT = 100;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

const FeedQuery = z
	.object({
		limit: z.coerce.number().int().min(1).max(FEED_MAX_LIMIT).default(FEED_DEFAULT_LIMIT),
		cursor: cursorSchema.optional(),
		after: z.union([z.literal(''), cursorSchema]).optional(),
		type: z
			.string()
			.optional()
			.transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean) : undefined))
			.pipe(z.array(z.enum(EVENT_TYPES)).max(EVENT_TYPES.length).optional())
	})
	.refine((q) => !(q.cursor !== undefined && q.after !== undefined), {
		message: 'use either cursor (newest first) or after (oldest first), not both'
	});

export type FeedQuery = z.output<typeof FeedQuery>;

/** Parses `?limit`, `?cursor`, `?after`, `?type` (comma separated). 400 on anything invalid. */
export function parseFeedQuery(params: URLSearchParams): FeedQuery {
	const raw: Record<string, string> = {};
	for (const key of ['limit', 'cursor', 'after', 'type']) {
		const v = params.get(key);
		if (v !== null) raw[key] = v;
	}
	const parsed = FeedQuery.safeParse(raw);
	if (!parsed.success) throw new ApiError(400, 'invalid_request', describeZodError(parsed.error));
	return parsed.data;
}

/** The smallest ULID minted at `ms`: every id below it was minted earlier. */
export const ulidFloor = (ms: number) => encodeTime(ms, 10) + '0'.repeat(16);

export interface EventList {
	object: 'list';
	data: EventJson[];
	hasMore: boolean;
	nextCursor: string | null;
}

export async function listEvents(db: DB, projectId: string, q: FeedQuery, now = Date.now()): Promise<EventList> {
	const ascending = q.after !== undefined;
	const where: SQL[] = [eq(event.projectId, projectId), lt(event.id, ulidFloor(now - FEED_STABILITY_MS))];
	if (q.after) where.push(gt(event.id, q.after));
	if (q.cursor) where.push(lt(event.id, q.cursor));
	if (q.type) where.push(inArray(event.type, q.type));

	const rows = await db
		.select()
		.from(event)
		.where(and(...where))
		.orderBy(ascending ? asc(event.id) : desc(event.id))
		.limit(q.limit + 1);
	const hasMore = rows.length > q.limit;
	const page = rows.slice(0, q.limit);
	return {
		object: 'list',
		data: page.map(eventJson),
		hasMore,
		// Pass it back as `after` (oldest first) or `cursor` (newest first), same as it came.
		nextCursor: hasMore ? page[page.length - 1]!.id : null
	};
}

/** One of the project's events, or 404 (also for another project's event). */
export async function getEvent(db: DB, projectId: string, id: string): Promise<EventJson> {
	if (!ULID.test(id)) throw notFound('Event');
	const row = await db.query.event.findFirst({ where: and(eq(event.id, id.toUpperCase()), eq(event.projectId, projectId)) });
	if (!row) throw notFound('Event');
	return eventJson(row);
}
