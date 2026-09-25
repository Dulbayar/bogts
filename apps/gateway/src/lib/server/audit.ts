/** The dashboard's audit trail (`audit_log`). Never put secrets in `detail`. */
import { newId } from './ids';
import type { DB } from './db';
import { auditLog } from './schema';
import type { AdminIdentity } from './auth/admin';

/** `access:<email>` or `password`: who did it. */
export function actorOf(admin: AdminIdentity): string {
	return admin.method === 'access' ? `access:${admin.email}` : 'password';
}

export async function recordAudit(
	db: DB,
	input: { admin: AdminIdentity; action: string; subject?: string | null; detail?: Record<string, unknown> },
	now = Date.now()
): Promise<void> {
	await db.insert(auditLog).values({
		id: newId(),
		actor: actorOf(input.admin),
		action: input.action,
		subject: input.subject ?? null,
		detail: input.detail ?? null,
		createdAt: now
	});
}
