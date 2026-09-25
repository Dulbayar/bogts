/** Dashboard reads for emitted events and their webhook deliveries. */
import { and, asc, count, desc, eq, gt, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { batchSelect, leftJoined, type DB } from '../db';
import { eventJson } from '../events/public';
import { delivery, deliveryAttempt, event, project } from '../schema';
import {
	all,
	failingDelivery,
	isLatestDelivery,
	finishPage,
	latestDeliveryJoin,
	PAGE_SIZE,
	scoped,
	summarizeDelivery,
	type Cursor,
	type Page
} from './common';

export const EVENT_TILES = ['succeeded', 'retrying', 'failed'] as const;
/** `failing`: retrying or failed now, created in the last `FAILING_WINDOW_MS` (what Overview and the sidebar count). */
export type EventStateFilter = 'succeeded' | 'retrying' | 'failed' | 'queued' | 'failing';

export type EventFilter = { projectId: string | null; state?: EventStateFilter | null; subjectId?: string | null; now?: number };

export const FAILING_WINDOW_MS = 7 * 86_400_000;

export function eventFilterFrom(url: URL, projectId: string | null, now = Date.now()): EventFilter {
	const s = url.searchParams.get('status');
	const state = s === 'succeeded' || s === 'retrying' || s === 'failed' || s === 'queued' || s === 'failing' ? s : null;
	return { projectId, state, now };
}

const NOT_SKIPPED = sql`coalesce(${delivery.lastError}, '') != 'no_webhook_url'`;

/** An event whose latest delivery is failing now and was created in the window. Use with `latestDeliveryJoin`. */
export function failingCond(now: number): SQL | undefined {
	return and(failingDelivery, gte(delivery.createdAt, now - FAILING_WINDOW_MS));
}

function stateCond(state: EventStateFilter | null | undefined, now = Date.now()): SQL | undefined {
	switch (state) {
		case 'failing':
			return failingCond(now);
		case 'succeeded':
			return eq(delivery.status, 'succeeded');
		case 'failed':
			return and(eq(delivery.status, 'failed'), NOT_SKIPPED);
		case 'retrying':
			return and(eq(delivery.status, 'pending'), gt(delivery.attempts, 0), NOT_SKIPPED);
		case 'queued':
			return and(eq(delivery.status, 'pending'), eq(delivery.attempts, 0));
		default:
			return undefined;
	}
}

/** The subject's page, from the event type's prefix. */
export function subjectHref(type: string, subjectId: string): string | null {
	if (type.startsWith('invoice.')) return `/admin/payments/${subjectId}`;
	if (type.startsWith('subscription.')) return `/admin/subscriptions/${subjectId}`;
	if (type.startsWith('charge.')) return `/admin/charges/${subjectId}`;
	return null;
}

const amountOf = (data: Record<string, unknown>): number | null => (typeof data.amount === 'number' ? data.amount : null);

function listEventsQuery(db: DB, f: EventFilter, cursor: Cursor) {
	return db
		.select(batchSelect({ event, delivery, projectName: project.name }))
		.from(event)
		.innerJoin(project, eq(project.id, event.projectId))
		.leftJoin(delivery, latestDeliveryJoin)
		.where(
			all(
				scoped(event.projectId, f.projectId),
				f.subjectId ? eq(event.subjectId, f.subjectId) : undefined,
				stateCond(f.state, f.now),
				cursor.before ? lt(event.id, cursor.before) : undefined,
				cursor.after ? gt(event.id, cursor.after) : undefined
			)
		)
		.orderBy(cursor.after ? asc(event.id) : desc(event.id))
		.limit(PAGE_SIZE + 1);
}

function listEventsFrom(rows: Awaited<ReturnType<typeof listEventsQuery>>, cursor: Cursor) {
	return finishPage(
		rows.map((r) => ({
			id: r.event.id,
			type: r.event.type,
			subjectId: r.event.subjectId,
			subjectHref: subjectHref(r.event.type, r.event.subjectId),
			amount: amountOf(r.event.data),
			projectId: r.event.projectId,
			projectName: r.projectName,
			createdAt: r.event.createdAt,
			delivery: summarizeDelivery(leftJoined(r.delivery, 'id'))
		})),
		cursor
	);
}

export async function listEvents(db: DB, f: EventFilter, cursor: Cursor = {}) {
	return listEventsFrom(await listEventsQuery(db, f, cursor), cursor);
}
export type EventListRow = ReturnType<typeof listEventsFrom> extends Page<infer R> ? R : never;

const sumIf = (cond: SQL | undefined) => sql<number>`coalesce(sum(case when ${cond} then 1 else 0 end), 0)`;

/**
 * The tiles' counts. Deliveries are scoped by their own `project_id`, which
 * is always their event's (both are written by one `eventInserts`).
 * "Succeeded" (most rows) is not counted row by row: it is the events that
 * have a delivery (a scan of `delivery_event_id_idx` alone) minus those whose
 * latest delivery is pending or failed (few rows, found by status).
 */
function eventCountsStatements(db: DB, f: EventFilter) {
	const scope = scoped(delivery.projectId, f.projectId);
	return [
		db.select({ n: count() }).from(event).where(scoped(event.projectId, f.projectId)),
		db.select({ n: sql<number>`count(distinct ${delivery.eventId})` }).from(delivery).where(scope),
		db
			.select(batchSelect({ unsettled: count(), retrying: sumIf(stateCond('retrying')), failed: sumIf(stateCond('failed')) }))
			.from(delivery)
			.where(all(inArray(delivery.status, ['pending', 'failed']), isLatestDelivery, scope))
	] as const;
}

type EventCountRows = readonly [{ n: number }[], { n: number }[], { unsettled: number; retrying: number; failed: number }[]];

function eventCountsFrom([[allN], [delivered], [open]]: EventCountRows): Record<string, number> {
	return {
		all: allN?.n ?? 0,
		succeeded: Number(delivered?.n ?? 0) - (open?.unsettled ?? 0),
		retrying: Number(open?.retrying ?? 0),
		failed: Number(open?.failed ?? 0)
	};
}

export async function eventCounts(db: DB, f: EventFilter): Promise<Record<string, number>> {
	return eventCountsFrom(await db.batch(eventCountsStatements(db, f)));
}

/** The events list and its tiles in one round trip. */
export async function eventsPage(db: DB, f: EventFilter, cursor: Cursor = {}) {
	const [rows, ...counts] = await db.batch([listEventsQuery(db, f, cursor), ...eventCountsStatements(db, f)]);
	return { page: listEventsFrom(rows, cursor), counts: eventCountsFrom(counts) };
}

export type DeliveryAttemptView = {
	id: string;
	number: number;
	trigger: string | null;
	url: string | null;
	succeeded: boolean;
	httpStatus: number | null;
	error: string | null;
	signature: string | null;
	responseBody: string | null;
	durationMs: number | null;
	createdAt: number;
};

/** Per-attempt rows (`delivery_attempt`), newest first. */
function attemptsQuery(db: DB, eventId: string) {
	return db
		.select({
			id: deliveryAttempt.id,
			number: deliveryAttempt.number,
			trigger: deliveryAttempt.trigger,
			url: deliveryAttempt.url,
			succeeded: deliveryAttempt.succeeded,
			httpStatus: deliveryAttempt.httpStatus,
			error: deliveryAttempt.error,
			signature: deliveryAttempt.signature,
			responseBody: deliveryAttempt.responseBody,
			durationMs: deliveryAttempt.durationMs,
			createdAt: deliveryAttempt.createdAt
		})
		.from(deliveryAttempt)
		.where(eq(deliveryAttempt.eventId, eventId))
		.orderBy(desc(deliveryAttempt.number))
		.limit(100);
}

/** The event page in one round trip: the deliveries and attempts are read by the event id. */
export async function getEventDetail(db: DB, id: string) {
	const [[row], deliveries, attemptRows] = await db.batch([
		db
			.select(batchSelect({ event, project: { id: project.id, name: project.name, webhookUrl: project.webhookUrl } }))
			.from(event)
			.innerJoin(project, eq(project.id, event.projectId))
			.where(eq(event.id, id))
			.limit(1),
		db.select().from(delivery).where(eq(delivery.eventId, id)).orderBy(desc(delivery.id)),
		attemptsQuery(db, id)
	]);
	if (!row) return null;
	const e = row.event;
	const latest = deliveries[0] ?? null;
	const attempts: DeliveryAttemptView[] = attemptRows;
	return {
		event: {
			id: e.id,
			type: e.type,
			subjectId: e.subjectId,
			subjectHref: subjectHref(e.type, e.subjectId),
			createdAt: e.createdAt,
			// Exactly the body a project receives (and `GET /v1/events` returns).
			payload: eventJson(e)
		},
		project: row.project,
		delivery: latest
			? {
					...summarizeDelivery(latest)!,
					lastResponseBody: latest.lastResponseBody,
					lastDurationMs: latest.lastDurationMs,
					updatedAt: latest.updatedAt,
					createdAt: latest.createdAt
				}
			: null,
		attempts
	};
}

/**
 * Events whose delivery is failing now (retrying or given up) in the last 7
 * days: the sidebar badge, same rows as `?status=failing`. Driven from the few
 * failing deliveries (`delivery_status_created_idx`), each checked to be its
 * event's latest; scoped by the delivery's project, which is its event's.
 */
export function failingDeliveryCountQuery(db: DB, projectId: string | null, now = Date.now()) {
	return db
		.select({ n: count() })
		.from(delivery)
		.where(all(failingCond(now), isLatestDelivery, scoped(delivery.projectId, projectId)));
}

export async function failingDeliveryCount(db: DB, projectId: string | null, now = Date.now()): Promise<number> {
	const [r] = await failingDeliveryCountQuery(db, projectId, now);
	return r?.n ?? 0;
}
