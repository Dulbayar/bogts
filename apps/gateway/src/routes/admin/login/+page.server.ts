import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import {
	adminCookieOptions,
	ADMIN_SESSION_COOKIE,
	LOGIN_WINDOW_MS,
	loginRateKey,
	loginWithPassword
} from '$lib/server/auth/admin';
import { requireConfig } from '$lib/server/locals';
import { rateLimit } from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

/** Only same-site dashboard paths are accepted as `?next=`. */
function safeNext(raw: string | null): string {
	return raw && /^\/admin(\/[\w\-/.]*)?(\?[\w\-=&%.]*)?$/.test(raw) && !raw.startsWith('/admin/login') ? raw : '/admin';
}

export const load: PageServerLoad = ({ locals, url }) => {
	const config = requireConfig(locals);
	if (locals.admin) redirect(303, safeNext(url.searchParams.get('next')));
	// Access handles sign-in. Without an Access identity, redirecting to /admin would loop back here.
	return { access: config.admin.mode === 'access' };
};

export const actions: Actions = {
	default: async ({ request, locals, cookies, url, getClientAddress }) => {
		const config = requireConfig(locals);
		if (config.admin.mode !== 'password') return fail(400, { error: 'Sign in through Cloudflare Access.' });
		const form = await request.formData();
		const password = form.get('password');
		if (typeof password !== 'string' || !password) return fail(400, { error: 'Enter the password.' });

		const ip = getClientAddress();
		const result = await loginWithPassword(locals.db, config, { password, ip });
		if (!result.ok) {
			if (result.reason === 'rate_limited') {
				const [row] = await locals.db
					.select({ windowStart: rateLimit.windowStart })
					.from(rateLimit)
					.where(eq(rateLimit.key, loginRateKey(ip)))
					.limit(1);
				const left = row ? row.windowStart + LOGIN_WINDOW_MS - Date.now() : LOGIN_WINDOW_MS;
				const minutes = Math.max(1, Math.ceil(left / 60_000));
				return fail(429, { error: `Too many attempts. Try again in ${minutes} min.` });
			}
			return fail(400, { error: 'Wrong password.' });
		}
		cookies.set(ADMIN_SESSION_COOKIE, result.session.value, adminCookieOptions(result.session.expiresAt, url));
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
