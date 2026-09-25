import { describe, expect, it } from 'vitest';
import { newId } from '$lib/server/ids';
import { invoice } from '$lib/server/schema';
import { createTestDb, seedProject, testConfig, type TestDb } from '$lib/server/testdb';
import { actions, load } from './+page.server';

function locals(db: TestDb = createTestDb()) {
	return { db, config: testConfig(), admin: { method: 'password' }, waitUntil: () => {} } as unknown as App.Locals;
}

describe('/admin/payments/:id', () => {
	it('404s for a missing invoice', async () => {
		const id = newId();
		await expect((load as unknown as (e: unknown) => Promise<unknown>)({ locals: locals(), params: { id } })).rejects.toMatchObject({ status: 404 });
		const res = await (actions.cancel as unknown as (e: unknown) => Promise<unknown>)({ locals: locals(), params: { id } });
		expect(res).toMatchObject({ status: 404, data: { error: 'Payment not found', action: 'cancel' } });
	});

	it('shows the project name, not its webhook URL (D1 batch rows are objects)', async () => {
		const db = createTestDb();
		// Production D1 behaviour exactly: repeated column names collapse silently.
		db.$d1.strictColumns = false;
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee', webhookUrl: 'https://nomad.test/hooks' });
		const id = newId();
		const now = Date.now();
		await db.insert(invoice).values({
			id,
			projectId: p.id,
			provider: 'qpay',
			amount: 49_000,
			reference: 'ord-1',
			description: 'Pro plan',
			status: 'pending',
			expiresAt: now + 1800_000,
			createdAt: now,
			updatedAt: now
		});
		const data = (await (load as unknown as (e: unknown) => Promise<unknown>)({ locals: locals(db), params: { id } })) as {
			invoice: { id: string; reference: string; status: string; amount: number; createdAt: number };
			project: { id: string; name: string; webhookUrl: string | null };
		};
		expect(data.project).toEqual({ id: p.id, name: 'Nomad Coffee', webhookUrl: 'https://nomad.test/hooks' });
		expect(data.invoice).toMatchObject({ id, reference: 'ord-1', status: 'pending', amount: 49_000, createdAt: now });
	});
});
