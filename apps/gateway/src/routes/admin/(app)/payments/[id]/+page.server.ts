import { error } from '@sveltejs/kit';
import { adminContext, adminOnly, failFrom } from '$lib/server/admin/actions';
import { isId } from '$lib/server/admin/common';
import { getInvoiceDetail } from '$lib/server/admin/invoices';
import { ApiError } from '$lib/server/api/errors';
import { recordAudit } from '$lib/server/audit';
import { cancelInvoice } from '$lib/server/services/invoices';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	adminOnly(locals);
	const detail = isId(params.id) ? await getInvoiceDetail(locals.db, params.id) : null;
	if (!detail) error(404, { message: `No payment with id ${params.id}`, code: 'not_found' });
	return detail;
};

export const actions: Actions = {
	cancel: async ({ locals, params }) => {
		const { admin, ctx } = adminContext(locals);
		const detail = await getInvoiceDetail(locals.db, params.id);
		if (!detail) return failFrom(new ApiError(404, 'not_found', 'Payment not found'), 'cancel');
		try {
			await cancelInvoice(ctx, detail.project.id, params.id);
		} catch (err) {
			return failFrom(err, 'cancel');
		}
		await recordAudit(locals.db, { admin, action: 'invoice.cancel', subject: params.id });
		return { ok: true };
	}
};
