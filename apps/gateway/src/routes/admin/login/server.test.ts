import { describe, expect, it } from 'vitest';
import { createTestDb, testConfig } from '$lib/server/testdb';
import { load } from './+page.server';

const access = testConfig({ admin: { mode: 'access', access: { teamDomain: 'team.cloudflareaccess.com', aud: 'aud-tag-123' } } });

function run(config: ReturnType<typeof testConfig>, admin: App.Locals['admin'] = null) {
	const url = new URL('https://payments.test/admin/login');
	const locals = { db: createTestDb(), config, admin } as unknown as App.Locals;
	return (load as unknown as (e: unknown) => unknown)({ locals, url });
}

describe('/admin/login load', () => {
	it('shows the Access sign-in state instead of looping back to /admin', () => {
		expect(run(access)).toEqual({ access: true });
	});

	it('shows the password form in password mode', () => {
		expect(run(testConfig())).toEqual({ access: false });
	});

	it('sends a signed-in operator on', () => {
		expect(() => run(access, { method: 'access', email: 'a@b.mn' })).toThrow(expect.objectContaining({ status: 303, location: '/admin' }));
	});
});
