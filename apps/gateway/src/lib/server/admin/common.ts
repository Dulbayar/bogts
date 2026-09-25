/**
 * Shared pieces of the dashboard's query modules: cursor paging, the project
 * scope, and the events + deliveries attached to a subject.
 */
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { DB } from '../db';
import { delivery, event, project, type Delivery } from '../schema';
import { deliveryState, type DeliveryState } from '$lib/status';

export const PAGE_SIZE = 50;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** True for a ULID (our ids). */
export const isId = (v: string | null | undefined): v is string => !!v && ULID.test(v);

export type Cursor = { before?: string; after?: string };
export type Page<T> = { rows: T[]; newer: string | null; older: string | null };

/** `?before=<id>` (older rows) or `?after=<id>` (newer rows); anything else is ignored. */
export function cursorFrom(url: URL): Cursor {
	const before = url.searchParams.get('before');
	const after = url.searchParams.get('after');
	if (isId(before)) return { before };
	if (isId(after)) return { after };
	return {};
}

/**
 * Finishes a page fetched with `limit(size + 1)`, ordered by id descending
 * (or ascending when paging `after`, which this flips back).
 */
export function finishPage<T extends { id: string }>(fetched: T[], cursor: Cursor, size = PAGE_SIZE): Page<T> {
	const hasMore = fetched.length > size;
	let rows = fetched.slice(0, size);
	if (cursor.after) rows = rows.reverse();
	const first = rows[0]?.id ?? null;
	const last = rows[rows.length - 1]?.id ?? null;
	const newer = cursor.after ? (hasMore ? first : null) : cursor.before ? first : null;
	const older = cursor.after ? last : hasMore ? last : null;
	return { rows, newer: rows.length ? newer : null, older: rows.length ? older : null };
}

/** `?project=<id>`, when it names a project that exists. */
export async function scopeFrom(db: DB, url: URL): Promise<string | null> {
	const id = url.searchParams.get('project');
	if (!isId(id)) return null;
	const [row] = await db.select({ id: project.id }).from(project).where(eq(project.id, id)).limit(1);
	return row ? row.id : null;
}

/** AND of the defined conditions (drizzle's `and` skips undefined). */
export const all = (...conds: (SQL | undefined)[]) => and(...conds);

/** The newest delivery of each event (normally the only one). */
export const latestDeliveryJoin = sql`${delivery.id} = (select max(d2.id) from delivery d2 where d2.event_id = ${event.id})`;

export type DeliverySummary = {
	id: string;
	state: DeliveryState;
	attempts: number;
	lastStatus: number | null;
	lastError: string | null;
	nextAttemptAt: number | null;
	deliveredAt: number | null;
};

export function summarizeDelivery(d: Delivery | null | undefined): DeliverySummary | null {
	if (!d) return null;
	return {
		id: d.id,
		state: deliveryState(d),
		attempts: d.attempts,
		lastStatus: d.lastStatus,
		lastError: d.lastError,
		nextAttemptAt: d.status === 'pending' ? d.nextAttemptAt : null,
		deliveredAt: d.deliveredAt
	};
}

export type SubjectEvent = {
	id: string;
	type: string;
	createdAt: number;
	delivery: DeliverySummary | null;
};

/** Events emitted about a subject (or several), newest first, with their delivery. */
export async function eventsForSubjects(db: DB, subjectIds: string[]): Promise<SubjectEvent[]> {
	if (subjectIds.length === 0) return [];
	const events = await db
		.select()
		.from(event)
		.where(inArray(event.subjectId, subjectIds))
		.orderBy(desc(event.id))
		.limit(200);
	if (events.length === 0) return [];
	const deliveries = await db
		.select()
		.from(delivery)
		.where(inArray(
			delivery.eventId,
			events.map((e) => e.id)
		))
		.orderBy(desc(delivery.id));
	const byEvent = new Map<string, Delivery>();
	for (const d of deliveries) if (!byEvent.has(d.eventId)) byEvent.set(d.eventId, d);
	return events.map((e) => ({
		id: e.id,
		type: e.type,
		createdAt: e.createdAt,
		delivery: summarizeDelivery(byEvent.get(e.id))
	}));
}

/** Project names by id, for list rows. */
export async function projectNames(db: DB): Promise<Map<string, string>> {
	const rows = await db.select({ id: project.id, name: project.name }).from(project);
	return new Map(rows.map((r) => [r.id, r.name]));
}

/** SQL for a delivery that is failing now: retrying or given up, and not merely missing a webhook URL. */
export const failingDelivery = sql`(${delivery.status} = 'failed' or (${delivery.status} = 'pending' and ${delivery.attempts} > 0)) and coalesce(${delivery.lastError}, '') != 'no_webhook_url'`;

/** Scope condition helper: `eq(column, projectId)` when scoped. */
export function scoped(column: AnySQLiteColumn, projectId: string | null): SQL | undefined {
	return projectId ? eq(column, projectId) : undefined;
}
