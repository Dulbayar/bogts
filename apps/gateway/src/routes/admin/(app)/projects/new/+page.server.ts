import { fail } from '@sveltejs/kit';
import { adminContext, adminOnly, failFrom } from '$lib/server/admin/actions';
import { allowsLocalWebhooks } from '$lib/server/admin/health';
import { createProject, parseWebhookUrl } from '$lib/server/admin/projects';
import { recordAudit } from '$lib/server/audit';
import { requireConfig } from '$lib/server/locals';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	adminOnly(locals);
	return { allowLocal: allowsLocalWebhooks(requireConfig(locals)) };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const { admin, config } = adminContext(locals);
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		const rawUrl = String(form.get('webhookUrl') ?? '');
		if (!name.trim()) return fail(400, { error: 'Enter a name', action: 'create', name, webhookUrl: rawUrl });
		try {
			const webhookUrl = parseWebhookUrl(rawUrl, allowsLocalWebhooks(config));
			const created = await createProject(locals.db, config.encryptionKey, { name, webhookUrl });
			await recordAudit(locals.db, { admin, action: 'project.create', subject: created.id, detail: { name: name.trim() } });
			return { created };
		} catch (err) {
			const f = failFrom(err, 'create');
			return fail(f.status, { ...f.data, name, webhookUrl: rawUrl });
		}
	}
};
