import { deploymentMode } from '$lib/server/admin/health';
import { requireConfig } from '$lib/server/locals';
import { THEME_COOKIE, themeFrom } from '$lib/server/admin/prefs';
import { redirect } from '@sveltejs/kit';
import { isLoginPath } from '$lib/server/gate';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, cookies, url }) => {
	const config = requireConfig(locals);
	// The admin area checks the operator itself, whatever the hooks decided (see adminOnly).
	if (!locals.admin && !isLoginPath(url.pathname)) redirect(303, '/admin/login');
	return {
		/** null only on the login page */
		admin: locals.admin,
		authMode: config.admin.mode,
		env: deploymentMode(config),
		theme: themeFrom(cookies.get(THEME_COOKIE)),
		/** The instance's hostname, no port */
		host: url.hostname
	};
};
