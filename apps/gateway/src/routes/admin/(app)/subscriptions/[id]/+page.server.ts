import { error } from '@sveltejs/kit';
import { adminOnly, adminContext, confirmed, failFrom } from '$lib/server/admin/actions';
import { isId } from '$lib/server/admin/common';
import { getSubscriptionDetail } from '$lib/server/admin/subscriptions';
import { ApiError } from '$lib/server/api/errors';
import { actorOf, recordAudit } from '$lib/server/audit';
import { cancelSubscription } from '$lib/server/services/subscriptions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	adminOnly(locals);
	const detail = isId(params.id) ? await getSubscriptionDetail(locals.db, params.id) : null;
	if (!detail) error(404, { message: `No subscription with id ${params.id}`, code: 'not_found' });
	return detail;
};

export const actions: Actions = {
	cancel: async ({ locals, params, request }) => {
		const { admin, ctx } = adminContext(locals);
		const form = await request.formData();
		const detail = await getSubscriptionDetail(locals.db, params.id);
		if (!detail) return failFrom(new ApiError(404, 'not_found', 'Subscription not found'), 'cancel');
		if (!confirmed(form, detail.subscription.customerRef)) {
			return failFrom(new ApiError(400, 'invalid_request', 'Type the customer reference to confirm'), 'cancel');
		}
		try {
			await cancelSubscription(ctx, detail.project.id, params.id, actorOf(admin));
		} catch (err) {
			return failFrom(err, 'cancel');
		}
		await recordAudit(locals.db, { admin, action: 'subscription.cancel', subject: params.id });
		return { ok: true };
	}
};
