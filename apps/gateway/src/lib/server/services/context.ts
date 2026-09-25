import type { Config } from '../env';
import type { DB } from '../db';

/** Everything a service or provider needs. Routes build it from `App.Locals`. */
export interface ServiceContext {
	db: DB;
	config: Config;
	/** Defaults to Date.now(); tests pin it. */
	now?: number;
	/** Background work (first delivery attempt). Absent in tests and the cron. */
	waitUntil?: (task: Promise<unknown>) => void;
}

export const nowOf = (ctx: ServiceContext) => ctx.now ?? Date.now();
