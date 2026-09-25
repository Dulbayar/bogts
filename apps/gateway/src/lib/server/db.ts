import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/** Drizzle over the `DB` binding. Cheap: call it per request. */
export function getDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type DB = ReturnType<typeof getDb>;

/** One statement that `db.batch([...])` accepts, for modules that hand statements to a caller's batch. */
export type BatchItem = Parameters<DB['batch']>[0][number];

export { schema };
