/**
 * Every request passes through here.
 *
 * 1. `locals`: env, db, config (null when not configured), admin, waitUntil.
 * 2. Fail closed: `/v1`, `/hooks` and `/admin` answer 503 JSON `not_configured`
 *    while `loadConfig` refuses (no admin auth, no ENCRYPTION_KEY, …), so an
 *    unconfigured deploy never runs open.
 * 3. The `/admin` gate: an unauthenticated request is redirected to
 *    `/admin/login` (the login page itself is open).
 * 4. The public pages' language (`locals.locale`, and `<html lang>`).
 * 5. Security headers on every response.
 */
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { errorJson } from '$lib/server/api/errors';
import { authenticateAdmin } from '$lib/server/auth/admin';
import { getDb } from '$lib/server/db';
import { tryLoadConfigCached } from '$lib/server/env';
import { deliverFresh } from '$lib/server/events/deliver';
import { ADMIN_LOGIN_PATH, applySecurityHeaders, areaOf, isLoginPath } from '$lib/server/gate';
import { LANG_COOKIE, pickLocale } from '$lib/i18n/public/detect';

export const handle: Handle = async ({ event, resolve }) => {
	const { url } = event;
	const area = areaOf(url.pathname);
	const env = event.platform?.env;
	if (!env) {
		return applySecurityHeaders(errorJson(500, 'internal_error', 'Cloudflare bindings unavailable'), url, area);
	}

	const loaded = tryLoadConfigCached(env);
	event.locals.env = env;
	event.locals.db = getDb(env.DB);
	event.locals.config = loaded.ok ? loaded.config : null;
	event.locals.admin = null;
	const ctx = event.platform?.ctx;
	event.locals.waitUntil = (promise) => {
		if (ctx) ctx.waitUntil(promise);
		else promise.catch(() => {});
	};

	if (!loaded.ok && (area === 'v1' || area === 'hooks' || area === 'admin')) {
		// The problems name variables only, never their values.
		const message = `Bogts is not configured: ${loaded.error.problems.join('; ')}`;
		return applySecurityHeaders(errorJson(503, 'not_configured', message), url, area);
	}

	if (area === 'admin' && loaded.ok) {
		event.locals.admin = await authenticateAdmin(event.request, loaded.config);
		if (!event.locals.admin && !isLoginPath(url.pathname)) {
			return applySecurityHeaders(
				new Response(null, { status: 303, headers: { location: ADMIN_LOGIN_PATH } }),
				url,
				area
			);
		}
	}

	// Public pages speak the payer's language; the dashboard is English.
	if (area === 'other') {
		const cookieHeader = event.request.headers.get('cookie') ?? '';
		const cookie = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([^;]*)`).exec(cookieHeader)?.[1] ?? null;
		const picked = pickLocale({
			query: url.searchParams.get('lang'),
			cookie,
			country: event.platform?.cf?.country,
			acceptLanguage: event.request.headers.get('accept-language')
		});
		event.locals.locale = picked.locale;
		if (picked.fromQuery && picked.locale !== cookie) {
			event.cookies?.set(LANG_COOKIE, picked.locale, {
				path: '/',
				httpOnly: true,
				secure: url.protocol === 'https:',
				sameSite: 'lax',
				maxAge: 60 * 60 * 24 * 365
			});
		}
	} else {
		event.locals.locale = 'en';
	}
	const lang = area === 'other' ? event.locals.locale : 'en';

	const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('%bogts.lang%', lang) });

	// Event delivery, inline: after any /v1 or /hooks request, attempt the
	// deliveries emitted in the last 2 minutes (usually the ones this request
	// just emitted) in the background. Never rejects; the cron retries the rest.
	if ((area === 'v1' || area === 'hooks') && loaded.ok) {
		event.locals.waitUntil(
			deliverFresh({ db: event.locals.db, config: loaded.config, waitUntil: event.locals.waitUntil })
		);
	}

	return applySecurityHeaders(response, url, area);
};

/** Unexpected errors: log the name only (never a message that might carry a secret). */
export const handleError: HandleServerError = ({ error, status }) => {
	if (status !== 404) console.error('[hooks] unhandled error', error instanceof Error ? error.name : typeof error);
	return { message: status === 404 ? 'Not found' : 'Internal error', code: status === 404 ? 'not_found' : 'internal_error' };
};
