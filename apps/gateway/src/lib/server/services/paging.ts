/**
 * Cursor pagination for `/v1` lists: `?limit` (1–100, default 20) and
 * `?cursor` (the last id of the previous page). Ids are ULIDs, so newest-first
 * by id is newest-first by creation.
 */
import { z } from 'zod';

/** The one list-cursor validator: a ULID in either case, normalised to uppercase. Anything else is a 400. */
export const cursorSchema = z
	.string()
	.regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, 'Invalid cursor')
	.transform((v) => v.toUpperCase());

export const ListQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
	cursor: cursorSchema.optional()
});
export type ListQuery = z.output<typeof ListQuery>;

export type ListPage<T> = { object: 'list'; data: T[]; hasMore: boolean; nextCursor: string | null };

/** Turns `limit + 1` rows (newest first) into a page. */
export function pageOf<R extends { id: string }, T>(rows: R[], limit: number, map: (row: R) => T): ListPage<T> {
	const hasMore = rows.length > limit;
	const page = rows.slice(0, limit);
	return { object: 'list', data: page.map(map), hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}

/** `url.searchParams` as a plain object for zod (the first value of each key). */
export function queryOf(url: URL): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of url.searchParams) if (!(k in out)) out[k] = v;
	return out;
}

export const iso = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());
