import { requestScope } from '$lib/server/admin/common';
import { failingDeliveryCountQuery } from '$lib/server/admin/events';
import { settingsProblem } from '$lib/server/admin/health';
import { projectOptionsFrom, projectOptionsStatements } from '$lib/server/admin/projects';
import { adminOnly } from '$lib/server/admin/actions';
import { brandingStatement, brandView } from '$lib/server/branding';
import { requireConfig } from '$lib/server/locals';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	const config = requireConfig(locals);
	// One round trip for the switcher, the sidebar badge and the branding; the scope is shared with the page.
	const now = Date.now();
	const [[projects, failingByProject, [failing], [brandRow]], scope] = await Promise.all([
		locals.db.batch([...projectOptionsStatements(locals.db, now), failingDeliveryCountQuery(locals.db, null, now), brandingStatement(locals.db)]),
		requestScope(locals, url)
	]);
	return {
		projects: projectOptionsFrom([projects, failingByProject]),
		scope,
		failing: failing?.n ?? 0,
		brand: brandView(brandRow),
		settingsProblem: settingsProblem(locals.env, config)
	};
};
