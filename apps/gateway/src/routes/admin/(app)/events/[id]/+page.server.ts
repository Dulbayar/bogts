import { error, fail } from '@sveltejs/kit';
import { adminContext, adminOnly, failFrom } from '$lib/server/admin/actions';
import { isId } from '$lib/server/admin/common';
import { getEventDetail } from '$lib/server/admin/events';
import { redeliverEvent } from '$lib/server/admin/redeliver';
import { recordAudit } from '$lib/server/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	adminOnly(locals);
	const detail = isId(params.id) ? await getEventDetail(locals.db, params.id) : null;
	if (!detail) error(404, { message: `No event with id ${params.id}`, code: 'not_found' });
	return detail;
};

export const actions: Actions = {
	redeliver: async ({ locals, params }) => {
		const { admin, ctx } = adminContext(locals);
		if (!isId(params.id)) return fail(404, { error: 'Event not found', action: 'redeliver' });
		try {
			await redeliverEvent(ctx, params.id);
		} catch (err) {
			return failFrom(err, 'redeliver');
		}
		await recordAudit(locals.db, { admin, action: 'event.redeliver', subject: params.id });
		return { ok: true };
	}
};
