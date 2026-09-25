/** Dashboard reads for emitted events and their webhook deliveries. */
import { and, asc, count, desc, eq, gt, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db';
import { eventJson } from '../events/public';
import { delivery, event, project } from '../schema';
import {
	all,
	failingDelivery,
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

export async function listEvents(db: DB, f: EventFilter, cursor: Cursor = {}) {
	const rows = await db
		.select({ event, delivery, projectName: project.name })
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
			delivery: summarizeDelivery(r.delivery)
		})),
		cursor
	);
}
export type EventListRow = Awaited<ReturnType<typeof listEvents>> extends Page<infer R> ? R : never;

export async function eventCounts(db: DB, f: EventFilter): Promise<Record<string, number>> {
	const base = scoped(event.projectId, f.projectId);
	const one = async (cond: SQL | undefined) => {
		const [r] = await db
			.select({ n: count() })
			.from(event)
			.leftJoin(delivery, latestDeliveryJoin)
			.where(all(base, cond));
		return r?.n ?? 0;
	};
	const [allN, succeeded, retrying, failed] = await Promise.all([
		one(undefined),
		one(stateCond('succeeded')),
		one(stateCond('retrying')),
		one(stateCond('failed'))
	]);
	return { all: allN, succeeded, retrying, failed };
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
async function attemptsFor(db: DB, eventId: string): Promise<DeliveryAttemptView[]> {
	{
		const rows = await db.all<Record<string, unknown>>(
			sql`select id, number, "trigger", url, succeeded, http_status, error, signature, response_body, duration_ms, created_at
			    from delivery_attempt where event_id = ${eventId} order by number desc limit 100`
		);
		return rows.map((r) => ({
			id: String(r.id),
			number: Number(r.number),
			trigger: (r.trigger as string | null) ?? null,
			url: (r.url as string | null) ?? null,
			succeeded: Boolean(r.succeeded),
			httpStatus: (r.http_status as number | null) ?? null,
			error: (r.error as string | null) ?? null,
			signature: (r.signature as string | null) ?? null,
			responseBody: (r.response_body as string | null) ?? null,
			durationMs: (r.duration_ms as number | null) ?? null,
			createdAt: Number(r.created_at)
		}));
	}
}

export async function getEventDetail(db: DB, id: string) {
	const [row] = await db
		.select({ event, project: { id: project.id, name: project.name, webhookUrl: project.webhookUrl } })
		.from(event)
		.innerJoin(project, eq(project.id, event.projectId))
		.where(eq(event.id, id))
		.limit(1);
	if (!row) return null;
	const e = row.event;
	const deliveries = await db.select().from(delivery).where(eq(delivery.eventId, e.id)).orderBy(desc(delivery.id));
	const latest = deliveries[0] ?? null;
	const attempts = await attemptsFor(db, e.id);
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

/** Events whose delivery is failing now (retrying or given up) in the last 7 days: the sidebar badge, same rows as `?status=failing`. */
export async function failingDeliveryCount(db: DB, projectId: string | null, now = Date.now()): Promise<number> {
	const [r] = await db
		.select({ n: count() })
		.from(event)
		.innerJoin(delivery, latestDeliveryJoin)
		.where(all(failingCond(now), scoped(event.projectId, projectId)));
	return r?.n ?? 0;
}
