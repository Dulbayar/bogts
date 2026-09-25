/**
 * The public event shape (docs/contracts.md "Public API shapes"): the webhook
 * body and each `GET /v1/events` item.
 *
 * `{ id, object: 'event', type, createdAt, data }`, with every timestamp as an
 * ISO-8601 UTC string. D1 keeps epoch-ms, including inside `event.data`, so
 * `data` is converted on the way out: top-level keys ending in `At` holding a
 * number (`paidAt`, `nextBillAt`, …) and `period.start` / `period.end`.
 * `@gege/bogts` types mirror exactly this.
 */
import type { EventRow } from '../schema';
import type { EventType } from './emit';

export interface EventJson {
	id: string;
	object: 'event';
	type: EventType;
	createdAt: string;
	data: Record<string, unknown>;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Converts the epoch-ms timestamps inside event `data` to ISO strings. */
export function isoEventData(data: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (key.endsWith('At') && typeof value === 'number' && Number.isFinite(value)) {
			out[key] = iso(value);
		} else if (key === 'period' && value && typeof value === 'object' && !Array.isArray(value)) {
			const p = value as Record<string, unknown>;
			out[key] = {
				...p,
				...(typeof p.start === 'number' ? { start: iso(p.start) } : {}),
				...(typeof p.end === 'number' ? { end: iso(p.end) } : {})
			};
		} else {
			out[key] = value;
		}
	}
	return out;
}

type EventLike = Pick<EventRow, 'id' | 'type' | 'createdAt'> & { data: unknown };

export function eventJson(e: EventLike): EventJson {
	return {
		id: e.id,
		object: 'event',
		type: e.type as EventType,
		createdAt: iso(e.createdAt),
		data: isoEventData((e.data ?? {}) as Record<string, unknown>)
	};
}
