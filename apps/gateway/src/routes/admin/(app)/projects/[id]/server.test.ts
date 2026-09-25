import { describe, expect, it } from 'vitest';
import { brandLogo } from '$lib/server/schema';
import { createTestDb, seedProject, testConfig } from '$lib/server/testdb';
import { actions } from './+page.server';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const brand = actions.brand as unknown as (e: unknown) => Promise<unknown>;

describe('/admin/projects/:id ?/brand', () => {
	it('stores no logo when the display name is invalid', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db, { name: 'Nomad Coffee' });
		const form = new FormData();
		form.set('displayName', 'x'.repeat(81));
		form.set('logo', new File([PNG], 'logo.png'));
		const locals = { db, config: testConfig(), admin: { method: 'password' }, waitUntil: () => {} } as unknown as App.Locals;
		const res = await brand({ locals, params: { id: project.id }, request: new Request('https://payments.test/x', { method: 'POST', body: form }) });
		expect(res).toMatchObject({ status: 400, data: { displayName: 'x'.repeat(81) } });
		expect(await db.select().from(brandLogo)).toHaveLength(0);
	});
});
