import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server';
import { ADMIN_SESSION_COOKIE, createAdminSession } from '$lib/server/auth/admin';
import type { Env } from '$lib/server/env';
import { TEST_ADMIN_PASSWORD, TEST_ENCRYPTION_KEY, testConfig } from '$lib/server/testdb';

const configured: Env = {
	DB: {} as D1Database,
	ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
	ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
	PUBLIC_ORIGIN: 'https://payments.test'
};
const unconfigured: Env = { DB: {} as D1Database, ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };

function run(path: string, env: Env | null, headers: Record<string, string> = {}) {
	const url = new URL(`https://payments.test${path}`);
	const event = {
		url,
		request: new Request(url, { headers }),
		platform: env ? { env, ctx: { waitUntil: vi.fn() } } : undefined,
		locals: {}
	} as unknown as RequestEvent;
	const resolve = vi.fn(async () => new Response('page', { headers: { 'content-type': 'text/html' } }));
	return { event, resolve, response: handle({ event, resolve }) };
}

describe('hooks: fail closed', () => {
	it.each(['/v1/invoices', '/admin', '/admin/login', '/hooks/bonum'])('%s answers 503 JSON when not configured', async (path) => {
		const { response, resolve } = run(path, unconfigured);
		const res = await response;
		expect(res.status).toBe(503);
		expect(resolve).not.toHaveBeenCalled();
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe('not_configured');
		expect(body.error.message).toContain('ADMIN_PASSWORD');
		expect(body.error.message).not.toContain(TEST_ENCRYPTION_KEY);
	});

	it('/health still answers (and reports) when not configured', async () => {
		const { response, resolve, event } = run('/health', unconfigured);
		await response;
		expect(resolve).toHaveBeenCalled();
		expect(event.locals.config).toBeNull();
	});

	it('500s without bindings', async () => {
		const { response } = run('/v1/invoices', null);
		expect((await response).status).toBe(500);
	});
});

describe('hooks: the /admin gate', () => {
	it('redirects an unauthenticated request to the login page', async () => {
		const { response, resolve } = run('/admin/projects', configured);
		const res = await response;
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/admin/login');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('serves the login page unauthenticated', async () => {
		const { response, resolve } = run('/admin/login', configured);
		expect((await response).status).toBe(200);
		expect(resolve).toHaveBeenCalled();
	});

	it('lets a signed-in operator through', async () => {
		const session = await createAdminSession(testConfig());
		const { response, event } = run('/admin', configured, { cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` });
		expect((await response).status).toBe(200);
		expect(event.locals.admin).toEqual({ method: 'password' });
	});

	it.each(['/%61dmin/projects', '/%61%64min', '/admin%2Fprojects', '/%E0%A4%A'])('gates the encoded or malformed path %s', async (path) => {
		const { response, resolve } = run(path, configured);
		const res = await response;
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('/admin/login');
		expect(resolve).not.toHaveBeenCalled();
	});

	it('does not treat /administrator as /admin', async () => {
		const { response, resolve } = run('/administrator', configured);
		await response;
		expect(resolve).toHaveBeenCalled();
	});

	it('sets locals for routes', async () => {
		const { response, event } = run('/v1/invoices', configured);
		await response;
		expect(event.locals.config?.admin.mode).toBe('password');
		expect(event.locals.db).toBeDefined();
		expect(typeof event.locals.waitUntil).toBe('function');
	});
});

describe('hooks: security headers', () => {
	it('on every response; no-store on the API and dashboard', async () => {
		const res = await run('/v1/invoices', configured).response;
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
		expect(res.headers.get('strict-transport-security')).toContain('max-age=');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
	});
});

describe('hooks: public page language', () => {
	function runPublic(path: string, headers: Record<string, string> = {}, country?: string) {
		const url = new URL(`https://payments.test${path}`);
		const set = vi.fn();
		const event = {
			url,
			request: new Request(url, { headers }),
			platform: { env: configured, ctx: { waitUntil: vi.fn() }, cf: country ? { country } : undefined },
			locals: {},
			cookies: { set }
		} as unknown as RequestEvent;
		const resolve = vi.fn(async (_e: unknown, opts?: { transformPageChunk?: (i: { html: string; done: boolean }) => string }) => {
			const html = opts?.transformPageChunk?.({ html: '<html lang="%bogts.lang%">', done: true }) ?? '';
			return new Response(html, { headers: { 'content-type': 'text/html' } });
		});
		return { event, set, response: handle({ event, resolve: resolve as never }) };
	}

	it('?lang= wins, is remembered, and sets <html lang>', async () => {
		const { event, set, response } = runPublic('/pay/X?lang=fr', { 'accept-language': 'ru' }, 'MN');
		expect(await (await response).text()).toBe('<html lang="fr">');
		expect(event.locals.locale).toBe('fr');
		expect(set).toHaveBeenCalledWith('bogts_lang', 'fr', expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax' }));
	});

	it('reads the cookie, then the country, then Accept-Language', async () => {
		let r = runPublic('/pay/X', { cookie: 'a=1; bogts_lang=es', 'accept-language': 'ru' }, 'MN');
		await r.response;
		expect(r.event.locals.locale).toBe('es');
		expect(r.set).not.toHaveBeenCalled();
		r = runPublic('/pay/X', { 'accept-language': 'en-US,en;q=0.9' }, 'MN');
		await r.response;
		expect(r.event.locals.locale).toBe('mn');
		r = runPublic('/pay/X', { 'accept-language': 'zh-CN' }, 'CN');
		await r.response;
		expect(r.event.locals.locale).toBe('zh-Hans');
	});

	it('keeps the dashboard in English', async () => {
		const { response } = runPublic('/admin/login?lang=fr');
		const res = await response;
		expect(await res.text()).toBe('<html lang="en">');
	});
});
