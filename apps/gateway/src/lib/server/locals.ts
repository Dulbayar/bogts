/** Helpers for reading `event.locals` in routes. */
import { ApiError } from './api/errors';
import type { AdminIdentity } from './auth/admin';
import type { Config } from './env';

/** The validated config. Hooks guarantee it on `/v1`, `/hooks` and `/admin`; elsewhere this 503s. */
export function requireConfig(locals: App.Locals): Config {
	if (!locals.config) throw new ApiError(503, 'not_configured', 'Bogts is not configured yet');
	return locals.config;
}

/** The signed-in operator. Hooks guarantee it on `/admin` pages (not the login page). */
export function requireAdmin(locals: App.Locals): AdminIdentity {
	if (!locals.admin) throw new ApiError(401, 'unauthorized', 'Sign in to the dashboard');
	return locals.admin;
}
