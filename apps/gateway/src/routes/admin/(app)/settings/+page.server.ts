import { fail } from '@sveltejs/kit';
import { adminContext, adminOnly } from '$lib/server/admin/actions';
import { callbackUrls, cronStatus, providerHealth } from '$lib/server/admin/health';
import { THEME_COOKIE } from '$lib/server/admin/prefs';
import { requireConfig } from '$lib/server/locals';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	adminOnly(locals);
	const config = requireConfig(locals);
	return {
		providers: providerHealth(locals.env, config),
		callbacks: callbackUrls(config),
		warnings: config.warnings,
		security: {
			mode: config.admin.mode,
			accessTeam: config.admin.mode === 'access' ? config.admin.access.teamDomain : null,
			// loadConfig refuses to run without a valid key, so reaching here means it is valid.
			encryptionKey: true,
			adminPassword: config.admin.mode === 'password'
		},
		cron: await cronStatus(locals.db)
	};
};

export const actions: Actions = {
	theme: async ({ locals, request, cookies, url }) => {
		adminContext(locals);
		const theme = String((await request.formData()).get('theme') ?? '');
		if (!['system', 'light', 'dark'].includes(theme)) return fail(400, { error: 'Pick a theme', action: 'theme' });
		const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
		if (theme === 'system') cookies.delete(THEME_COOKIE, { path: '/admin' });
		else cookies.set(THEME_COOKIE, theme, { path: '/admin', httpOnly: true, secure: !localHttp, sameSite: 'strict', maxAge: 60 * 60 * 24 * 365 });
		return { ok: true };
	}
};
