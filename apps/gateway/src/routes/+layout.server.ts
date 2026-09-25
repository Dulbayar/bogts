import { getBranding } from '$lib/server/branding';
import type { LayoutServerLoad } from './$types';

/** Every page: the company branding (accent, logo, name) and the public pages' language. */
export const load: LayoutServerLoad = async ({ locals }) => {
	return { brand: await getBranding(locals.db), locale: locals.locale ?? 'mn' };
};
