import { error } from '@sveltejs/kit';
import { adminOnly, adminContext, confirmed, failFrom } from '$lib/server/admin/actions';
import { getChargeDetail } from '$lib/server/admin/charges';
import { isId } from '$lib/server/admin/common';
import { ApiError } from '$lib/server/api/errors';
import { actorOf, recordAudit } from '$lib/server/audit';
import { reverseCharge } from '$lib/server/services/charges';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	adminOnly(locals);
	const detail = isId(params.id) ? await getChargeDetail(locals.db, params.id) : null;
	if (!detail) error(404, { message: `No charge with id ${params.id}`, code: 'not_found' });
	return detail;
};

export const actions: Actions = {
	reverse: async ({ locals, params, request }) => {
		const { admin, ctx } = adminContext(locals);
		const form = await request.formData();
		const detail = await getChargeDetail(locals.db, params.id);
		if (!detail) return failFrom(new ApiError(404, 'not_found', 'Charge not found'), 'reverse');
		if (!confirmed(form, String(detail.charge.amount))) {
			return failFrom(new ApiError(400, 'invalid_request', 'Type the amount to confirm'), 'reverse');
		}
		try {
			await reverseCharge(ctx, detail.project.id, params.id, actorOf(admin));
		} catch (err) {
			return failFrom(err, 'reverse');
		}
		await recordAudit(locals.db, { admin, action: 'charge.reverse', subject: params.id, detail: { amount: detail.charge.amount } });
		return { ok: true };
	}
};
