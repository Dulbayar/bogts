import { Column, getTableColumns, is, SQL, sql, Table, type GetColumnData } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/** Drizzle over the `DB` binding. Cheap: call it per request. */
export function getDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type DB = ReturnType<typeof getDb>;

/** One statement that `db.batch([...])` accepts, for modules that hand statements to a caller's batch. */
export type BatchItem = Parameters<DB['batch']>[0][number];

/* ------------------------------------------------------------------ *
 * Selects inside db.batch: every result column needs a unique name
 * ------------------------------------------------------------------ */

type Selection = { [key: string]: Column | SQL | SQL.Aliased | Table | Selection };

/** What `batchSelect` turns a selection into (field types kept). */
export type BatchSelection<T> = T extends Column
	? SQL.Aliased<GetColumnData<T>>
	: T extends SQL.Aliased<infer D>
		? SQL.Aliased<D>
		: T extends SQL<infer D>
			? SQL.Aliased<D>
			: T extends Table
				? { [K in keyof T['_']['columns']]: BatchSelection<T['_']['columns'][K]> }
				: { [K in keyof T]: BatchSelection<T[K]> };

function aliasAll(selection: Selection, prefix: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(selection)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (is(field, Column)) out[key] = sql`${field}`.mapWith(field).as(name);
		else if (is(field, SQL.Aliased)) out[key] = field.sql.as(name);
		else if (is(field, SQL)) out[key] = field.as(name);
		else if (is(field, Table)) out[key] = aliasAll(getTableColumns(field), name);
		else out[key] = aliasAll(field, name);
	}
	return out;
}

/**
 * A selection for a select that runs inside `db.batch([...])`: every column is
 * aliased to its path in the selection (`invoice.id`, `project.name`, …), so
 * no two result columns share a name.
 *
 * Why: D1's `batch()` returns rows as OBJECTS keyed by column name, and
 * drizzle-orm's D1 driver maps a batched row back by position
 * (`Object.keys(row)`, see `d1ToRawMapping` in drizzle-orm/d1/session.js). Two
 * columns with the same name (`id`, `name`, `status`, `created_at` from joined
 * tables) collapse into one key and every later field shifts: the payment page
 * once showed the project's webhook URL as its name. Outside a batch Drizzle
 * reads arrays (`raw()`) and names do not matter. Rule (docs/contracts.md): a
 * select inside `db.batch` that joins tables or computes columns goes through
 * this; the test D1 (`testdb.ts`) throws on any repeated name.
 *
 * Decoders are kept (`mapWith(column)`: json, boolean). One difference from
 * plain columns: a LEFT-joined group is not nulled when the join finds no row
 * (Drizzle only does that for bare columns); use `leftJoined` on it.
 */
export function batchSelect<const T extends Selection>(selection: T): BatchSelection<T> {
	return aliasAll(selection, '') as BatchSelection<T>;
}

/** A left-joined group from `batchSelect`: null when the join matched nothing (`key` is a NOT NULL column of it). */
export function leftJoined<T extends Record<string, unknown>>(group: T, key: keyof T): T | null {
	return group[key] === null ? null : group;
}

export { schema };
