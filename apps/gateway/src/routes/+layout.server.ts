import { EMPTY_BRAND, getBrandingCached } from '$lib/server/branding';
import { areaOf, isLoginPath } from '$lib/server/gate';
import type { LayoutServerLoad } from './$types';

/**
 * Every page: the public pages' language, and the company branding for pages
 * outside the dashboard (read through the per-isolate cache, so usually no
 * round trip). The dashboard's own layout reads the branding in its batch.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const brand = areaOf(url.pathname) === 'admin' && !isLoginPath(url.pathname) ? EMPTY_BRAND : await getBrandingCached(locals.db);
	return { brand, locale: locals.locale ?? 'mn' };
};
