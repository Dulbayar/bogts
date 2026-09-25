/**
 * Plumbing for dashboard form actions: the admin check, the ServiceContext
 * built from locals, and error → `fail()` mapping. Only `ApiError` messages
 * reach the page (they are safe by contract); anything else is generic.
 */
import { fail, redirect, type ActionFailure } from '@sveltejs/kit';
import { ApiError } from '../api/errors';
import type { AdminIdentity } from '../auth/admin';
import type { Config } from '../env';
import { requireAdmin, requireConfig } from '../locals';
import type { ServiceContext } from '../services/context';

export type ActionError = { error: string; action: string };

/**
 * The signed-in operator, or a redirect to the login page. Every admin load
 * and action calls this itself: the hooks gate classifies the raw path, and
 * loads/actions must not depend on it (an encoded path such as `/%61dmin`
 * reaches these routes without passing that gate).
 */
export function adminOnly(locals: App.Locals): AdminIdentity {
	if (!locals.admin) redirect(303, '/admin/login');
	return requireAdmin(locals);
}

/** Admin + config + a ServiceContext for the request. Redirects to login without an admin; 503 unconfigured. */
export function adminContext(locals: App.Locals): { admin: AdminIdentity; config: Config; ctx: ServiceContext } {
	const admin = adminOnly(locals);
	const config = requireConfig(locals);
	return { admin, config, ctx: { db: locals.db, config, waitUntil: locals.waitUntil } };
}

/** `fail(status, { error, action })` for a thrown error. */
export function failFrom(err: unknown, action: string): ActionFailure<ActionError> {
	if (err instanceof ApiError) {
		const status = err.status >= 400 && err.status < 600 ? err.status : 400;
		return fail(status, { error: err.message, action });
	}
	console.error(`[admin] ${action} failed`, err instanceof Error ? err.name : typeof err);
	return fail(500, { error: 'Something went wrong. Try again.', action });
}

/** The typed confirmation matches (trimmed, exact). */
export function confirmed(form: FormData, expected: string): boolean {
	return String(form.get('confirm') ?? '').trim() === expected.trim();
}
