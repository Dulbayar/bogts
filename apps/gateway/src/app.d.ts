import type { AdminIdentity } from '$lib/server/auth/admin';
import type { DB } from '$lib/server/db';
import type { Config, Env } from '$lib/server/env';

declare global {
	namespace App {
		interface Platform {
			env: Env;
		}
		interface Locals {
			/** The Worker bindings. Set by hooks on every request. */
			env: Env;
			/** Drizzle over `DB`. Set by hooks on every request. */
			db: DB;
			/**
			 * Validated configuration. Always set on `/v1`, `/hooks` and `/admin`
			 * (hooks answer 503 there otherwise); null only on open routes such as
			 * `/health` of an unconfigured deployment. Use `requireConfig(locals)`.
			 */
			config: Config | null;
			/** The signed-in operator. Always set on `/admin` pages except the login page. */
			admin: AdminIdentity | null;
			/** `ctx.waitUntil`: work that may outlive the response (inline event delivery). */
			waitUntil: (promise: Promise<unknown>) => void;
		}
		interface Error {
			code?: string;
		}
	}
}

export {};
