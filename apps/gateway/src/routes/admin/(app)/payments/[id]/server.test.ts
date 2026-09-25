import { describe, expect, it } from 'vitest';
import { newId } from '$lib/server/ids';
import { createTestDb, testConfig } from '$lib/server/testdb';
import { actions, load } from './+page.server';

function locals() {
	return { db: createTestDb(), config: testConfig(), admin: { method: 'password' }, waitUntil: () => {} } as unknown as App.Locals;
}

describe('/admin/payments/:id', () => {
	it('404s for a missing invoice', async () => {
		const id = newId();
		await expect((load as unknown as (e: unknown) => Promise<unknown>)({ locals: locals(), params: { id } })).rejects.toMatchObject({ status: 404 });
		const res = await (actions.cancel as unknown as (e: unknown) => Promise<unknown>)({ locals: locals(), params: { id } });
		expect(res).toMatchObject({ status: 404, data: { error: 'Payment not found', action: 'cancel' } });
	});
});
