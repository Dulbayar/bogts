import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Config } from '../env';
import { TEST_ADMIN_PASSWORD, createTestDb, testConfig } from '../testdb';
import {
	ADMIN_SESSION_COOKIE,
	ADMIN_SESSION_TTL_MS,
	LOGIN_LIMIT_GLOBAL,
	LOGIN_LIMIT_PER_IP,
	adminCookieOptions,
	authenticateAdmin,
	createAdminSession,
	loginWithPassword,
	verifyAccessJwt,
	verifyAdminSession
} from './admin';

const NOW = 1_800_000_000_000;
const ACCESS = { teamDomain: 'team.cloudflareaccess.com', aud: 'aud-tag-123' };
const accessConfig: Config = testConfig({ admin: { mode: 'access', access: ACCESS } });
const passwordConfig: Config = testConfig();

const withCookie = (value: string) =>
	new Request('https://payments.test/admin', { headers: { cookie: `other=1; ${ADMIN_SESSION_COOKIE}=${value}` } });

describe('password sessions', () => {
	it('a session this deployment signed is valid for 12 h', async () => {
		const s = await createAdminSession(passwordConfig, NOW);
		expect(s.expiresAt).toBe(NOW + ADMIN_SESSION_TTL_MS);
		expect(await verifyAdminSession(s.value, passwordConfig, NOW)).toBe(true);
		expect(await verifyAdminSession(s.value, passwordConfig, NOW + ADMIN_SESSION_TTL_MS - 1)).toBe(true);
		expect(await verifyAdminSession(s.value, passwordConfig, NOW + ADMIN_SESSION_TTL_MS)).toBe(false);
	});

	it('refuses tampering: a pushed-out expiry or a changed signature', async () => {
		const s = await createAdminSession(passwordConfig, NOW);
		const [v, exp, nonce, sig] = s.value.split('.') as [string, string, string, string];
		expect(await verifyAdminSession(`${v}.${Number(exp) + 1000}.${nonce}.${sig}`, passwordConfig, NOW)).toBe(false);
		const badSig = sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a');
		expect(await verifyAdminSession(`${v}.${exp}.${nonce}.${badSig}`, passwordConfig, NOW)).toBe(false);
		expect(await verifyAdminSession('garbage', passwordConfig, NOW)).toBe(false);
		expect(await verifyAdminSession('', passwordConfig, NOW)).toBe(false);
	});

	it('changing the password signs everyone out', async () => {
		const s = await createAdminSession(passwordConfig, NOW);
		const changed = testConfig({ admin: { mode: 'password', password: 'a different long password' } });
		expect(await verifyAdminSession(s.value, changed, NOW)).toBe(false);
	});

	it('a session cookie is worthless in Access mode', async () => {
		const s = await createAdminSession(passwordConfig, NOW);
		expect(await verifyAdminSession(s.value, accessConfig, NOW)).toBe(false);
		expect(await authenticateAdmin(withCookie(s.value), accessConfig, { now: NOW })).toBeNull();
	});

	it('authenticateAdmin reads the cookie', async () => {
		const s = await createAdminSession(passwordConfig, NOW);
		expect(await authenticateAdmin(withCookie(s.value), passwordConfig, { now: NOW })).toEqual({ method: 'password' });
		expect(await authenticateAdmin(new Request('https://payments.test/admin'), passwordConfig, { now: NOW })).toBeNull();
	});

	it('cookie options: HttpOnly, SameSite=Strict, Secure except on http://localhost', () => {
		const exp = NOW + 1;
		expect(adminCookieOptions(exp, new URL('https://payments.test/admin/login'))).toEqual({
			path: '/admin',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			expires: new Date(exp)
		});
		expect(adminCookieOptions(exp, new URL('http://localhost:5173/admin/login')).secure).toBe(false);
	});
});

describe('loginWithPassword', () => {
	it('accepts the password and returns a valid session', async () => {
		const db = createTestDb();
		const r = await loginWithPassword(db, passwordConfig, { password: TEST_ADMIN_PASSWORD, ip: '1.2.3.4', now: NOW });
		expect(r.ok).toBe(true);
		if (r.ok) expect(await verifyAdminSession(r.session.value, passwordConfig, NOW)).toBe(true);
	});

	it('refuses a wrong password', async () => {
		const db = createTestDb();
		const r = await loginWithPassword(db, passwordConfig, { password: 'nope', ip: '1.2.3.4', now: NOW });
		expect(r).toEqual({ ok: false, reason: 'invalid' });
	});

	it('rate-limits per IP, even for the right password, until the window passes', async () => {
		const db = createTestDb();
		for (let i = 0; i < LOGIN_LIMIT_PER_IP; i++) {
			await loginWithPassword(db, passwordConfig, { password: 'wrong', ip: '9.9.9.9', now: NOW });
		}
		const blocked = await loginWithPassword(db, passwordConfig, { password: TEST_ADMIN_PASSWORD, ip: '9.9.9.9', now: NOW });
		expect(blocked).toEqual({ ok: false, reason: 'rate_limited' });
		const other = await loginWithPassword(db, passwordConfig, { password: TEST_ADMIN_PASSWORD, ip: '8.8.8.8', now: NOW });
		expect(other.ok).toBe(true);
		const later = await loginWithPassword(db, passwordConfig, {
			password: TEST_ADMIN_PASSWORD,
			ip: '9.9.9.9',
			now: NOW + 15 * 60 * 1000 + 1
		});
		expect(later.ok).toBe(true);
	});

	it('the global limit counts only failures and never locks out the right password', async () => {
		const db = createTestDb();
		for (let i = 0; i < LOGIN_LIMIT_GLOBAL; i++) {
			const r = await loginWithPassword(db, passwordConfig, { password: `junk-${i}`, ip: `10.0.${i >> 8}.${i & 255}`, now: NOW });
			expect(r).toEqual({ ok: false, reason: 'invalid' });
		}
		const ok = await loginWithPassword(db, passwordConfig, { password: TEST_ADMIN_PASSWORD, ip: '1.2.3.4', now: NOW });
		expect(ok.ok).toBe(true);
		// Past the limit, more junk is refused as rate-limited; the password still works.
		expect(await loginWithPassword(db, passwordConfig, { password: 'junk', ip: '5.5.5.5', now: NOW })).toEqual({ ok: false, reason: 'rate_limited' });
		expect((await loginWithPassword(db, passwordConfig, { password: TEST_ADMIN_PASSWORD, ip: '6.6.6.6', now: NOW })).ok).toBe(true);
	});

	it('is off in Access mode', async () => {
		const db = createTestDb();
		const r = await loginWithPassword(db, accessConfig, { password: TEST_ADMIN_PASSWORD, ip: '1.2.3.4' });
		expect(r).toEqual({ ok: false, reason: 'wrong_mode' });
	});
});

describe('Cloudflare Access', () => {
	let privateKey: CryptoKey;
	let otherKey: CryptoKey;
	let keySet: ReturnType<typeof createLocalJWKSet>;

	beforeAll(async () => {
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey;
		otherKey = (await generateKeyPair('RS256')).privateKey;
		const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
		keySet = createLocalJWKSet({ keys: [jwk] });
	});

	const sign = (claims: Record<string, unknown>, opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: string } = {}) =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuedAt()
			.setIssuer(opts.iss ?? `https://${ACCESS.teamDomain}`)
			.setAudience(opts.aud ?? ACCESS.aud)
			.setExpirationTime(opts.exp ?? '5m')
			.sign(opts.key ?? privateKey);

	const accessRequest = (token: string) =>
		new Request('https://payments.test/admin', { headers: { 'cf-access-jwt-assertion': token } });

	it('accepts a valid token and returns the email', async () => {
		const token = await sign({ email: 'ops@example.com' });
		expect(await verifyAccessJwt(token, ACCESS, keySet)).toEqual({ email: 'ops@example.com' });
		expect(await authenticateAdmin(accessRequest(token), accessConfig, { keySet })).toEqual({
			method: 'access',
			email: 'ops@example.com'
		});
	});

	it('accepts a service token by its client id', async () => {
		const token = await sign({ common_name: 'abc.access' });
		expect(await verifyAccessJwt(token, ACCESS, keySet)).toEqual({ email: 'service:abc.access' });
	});

	it('refuses the wrong audience, issuer, signing key, or an expired token', async () => {
		expect(await verifyAccessJwt(await sign({ email: 'a@b.mn' }, { aud: 'other' }), ACCESS, keySet)).toBeNull();
		expect(await verifyAccessJwt(await sign({ email: 'a@b.mn' }, { iss: 'https://evil.cloudflareaccess.com' }), ACCESS, keySet)).toBeNull();
		expect(await verifyAccessJwt(await sign({ email: 'a@b.mn' }, { key: otherKey }), ACCESS, keySet)).toBeNull();
		expect(await verifyAccessJwt(await sign({ email: 'a@b.mn' }, { exp: '-10m' }), ACCESS, keySet)).toBeNull();
		expect(await verifyAccessJwt('not.a.jwt', ACCESS, keySet)).toBeNull();
	});

	it('refuses a token with no identity', async () => {
		expect(await verifyAccessJwt(await sign({}), ACCESS, keySet)).toBeNull();
	});

	it('ignores the unsigned email header', async () => {
		const req = new Request('https://payments.test/admin', {
			headers: { 'cf-access-authenticated-user-email': 'ops@example.com' }
		});
		expect(await authenticateAdmin(req, accessConfig, { keySet })).toBeNull();
	});

	it('does not accept an Access token in password mode', async () => {
		const token = await sign({ email: 'ops@example.com' });
		expect(await authenticateAdmin(accessRequest(token), passwordConfig, { keySet })).toBeNull();
	});
});
