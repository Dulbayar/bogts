import { requestScope } from '$lib/server/admin/common';
import { failingDeliveryCountQuery } from '$lib/server/admin/events';
import { settingsProblem } from '$lib/server/admin/health';
import { projectOptionsFrom, projectOptionsStatements } from '$lib/server/admin/projects';
import { adminOnly } from '$lib/server/admin/actions';
import { requireConfig } from '$lib/server/locals';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	const config = requireConfig(locals);
	// One round trip for the switcher and the sidebar badge; the scope is shared with the page.
	const now = Date.now();
	const [[projects, failingByProject, [failing]], scope] = await Promise.all([
		locals.db.batch([...projectOptionsStatements(locals.db, now), failingDeliveryCountQuery(locals.db, null, now)]),
		requestScope(locals, url)
	]);
	return {
		projects: projectOptionsFrom([projects, failingByProject]),
		scope,
		failing: failing?.n ?? 0,
		settingsProblem: settingsProblem(locals.env, config)
	};
};
