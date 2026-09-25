import { describe, expect, it } from 'vitest';
import { brandLogo } from '$lib/server/schema';
import { createTestDb, testConfig, type TestDb } from '$lib/server/testdb';
import { actions } from './+page.server';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

function event(db: TestDb, fields: Record<string, string>, logo?: Uint8Array<ArrayBuffer>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	if (logo) form.set('logo', new File([logo], 'logo.png'));
	const locals = { db, config: testConfig(), admin: { method: 'password' }, waitUntil: () => {} } as unknown as App.Locals;
	return { locals, request: new Request('https://payments.test/admin/settings?/branding', { method: 'POST', body: form }) };
}
const branding = actions.branding as unknown as (e: unknown) => Promise<unknown>;

describe('/admin/settings ?/branding', () => {
	it('stores no logo when another field is invalid', async () => {
		const db = createTestDb();
		const res = await branding(event(db, { companyName: 'Номин', supportEmail: 'nope' }, PNG));
		expect(res).toMatchObject({ status: 400 });
		expect(await db.select().from(brandLogo)).toHaveLength(0);
	});

	it('refuses a support email with a query or spaces', async () => {
		const db = createTestDb();
		for (const bad of ['help@nomin.mn?subject=x', 'help@nomin.mn&cc=a@b.mn', 'help me@nomin.mn', 'a%40b@nomin.mn']) {
			expect(await branding(event(db, { supportEmail: bad })), bad).toMatchObject({ status: 400 });
		}
	});

	it('saves, then sweeps orphaned logos older than the grace period', async () => {
		const db = createTestDb();
		const row = (hash: string, createdAt: number) => ({ hash, contentType: 'image/png' as const, data: 'AA==', size: 1, createdAt });
		await db.insert(brandLogo).values([row('a'.repeat(64), 0), row('b'.repeat(64), Date.now())]);
		const res = await branding(event(db, { companyName: 'Номин', supportEmail: 'help@nomin.mn' }, PNG));
		expect(res).toMatchObject({ ok: true });
		const hashes = (await db.select({ hash: brandLogo.hash }).from(brandLogo)).map((r) => r.hash);
		expect(hashes).not.toContain('a'.repeat(64)); // old orphan: gone
		expect(hashes).toContain('b'.repeat(64)); // fresh orphan: may be about to be saved
		expect(hashes).toHaveLength(2); // and the new logo
	});
});
