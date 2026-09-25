import { scopeFrom } from '$lib/server/admin/common';
import { failingDeliveryCount } from '$lib/server/admin/events';
import { settingsProblem } from '$lib/server/admin/health';
import { projectOptions } from '$lib/server/admin/projects';
import { adminOnly } from '$lib/server/admin/actions';
import { requireConfig } from '$lib/server/locals';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	adminOnly(locals);
	const config = requireConfig(locals);
	const [projects, scope, failing] = await Promise.all([
		projectOptions(locals.db),
		scopeFrom(locals.db, url),
		failingDeliveryCount(locals.db, null)
	]);
	return {
		projects,
		scope,
		failing,
		settingsProblem: settingsProblem(locals.env, config)
	};
};
