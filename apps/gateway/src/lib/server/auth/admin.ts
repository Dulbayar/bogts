/**
 * The dashboard gate.
 *
 * - **Cloudflare Access** (CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD): the
 *   `Cf-Access-Jwt-Assertion` JWT is verified against the team's JWKS, with
 *   `aud` and `iss` checked. The email header alone is never trusted: the
 *   Worker also answers where no Access policy applies (workers.dev, previews).
 *   In this mode the password is ignored entirely.
 * - **Password** (ADMIN_PASSWORD): a stateless session cookie,
 *   `v1.<expiresAt>.<nonce>.<hmac>`, 12 h, `HttpOnly; Secure; SameSite=Strict`,
 *   signed with a key derived from ENCRYPTION_KEY and the password, so changing
 *   the password signs everyone out. Login attempts are rate limited in D1.
 * - **Neither**: `loadConfig` throws and hooks answer 503; nothing here runs.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { hmacSha256Hex, timingSafeEqual } from '../crypto';
import type { DB } from '../db';
import type { AccessConfig, Config } from '../env';
import { randomBase62 } from '../ids';
import { ipRateKey } from '../ip';
import { consumeRateLimit, resetRateLimit } from '../rate-limit';

export type AdminIdentity = { method: 'access'; email: string } | { method: 'password' };

export const ADMIN_SESSION_COOKIE = 'bogts_admin';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Login attempts: per client IP, and for everyone together (a distributed guess). */
export const LOGIN_LIMIT_PER_IP = 10;
export const LOGIN_LIMIT_GLOBAL = 100;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * Cloudflare Access
 * ------------------------------------------------------------------ */

/** Per isolate: the team's key set is stable, and jose caches and refreshes it. */
let jwks: { team: string; keySet: JWTVerifyGetKey } | null = null;

function teamKeySet(teamDomain: string): JWTVerifyGetKey {
	if (!jwks || jwks.team !== teamDomain) {
		jwks = { team: teamDomain, keySet: createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`)) };
	}
	return jwks.keySet;
}

/**
 * Verifies an Access JWT. Returns the identity (the user's email, or
 * `service:<client id>` for an Access service token), or null.
 * `keySet` is for tests; production fetches the team's JWKS.
 */
export async function verifyAccessJwt(
	token: string,
	access: AccessConfig,
	keySet: JWTVerifyGetKey = teamKeySet(access.teamDomain)
): Promise<{ email: string } | null> {
	try {
		const { payload } = await jwtVerify(token, keySet, {
			audience: access.aud,
			issuer: `https://${access.teamDomain}`,
			algorithms: ['RS256'],
			clockTolerance: 30
		});
		if (typeof payload.email === 'string' && payload.email) return { email: payload.email };
		if (typeof payload.common_name === 'string' && payload.common_name) {
			return { email: `service:${payload.common_name}` };
		}
		return null;
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ *
 * Password sessions
 * ------------------------------------------------------------------ */

/** Per isolate: the derived key for the last (key, password) pair, so a request verifies with one HMAC, not two. */
let cachedSessionKey: { encryptionKey: string; password: string; key: Promise<string> } | null = null;

async function sessionKey(config: Config): Promise<string> {
	if (config.admin.mode !== 'password') throw new Error('password sessions are off in Access mode');
	const { encryptionKey } = config;
	const { password } = config.admin;
	if (cachedSessionKey?.encryptionKey !== encryptionKey || cachedSessionKey.password !== password) {
		const key = hmacSha256Hex(encryptionKey, `bogts admin session v1\u0000${password}`);
		cachedSessionKey = { encryptionKey, password, key };
		key.catch(() => (cachedSessionKey = null));
	}
	return cachedSessionKey.key;
}

/** A signed session value, valid for 12 h from `now`. */
export async function createAdminSession(config: Config, now = Date.now()): Promise<{ value: string; expiresAt: number }> {
	const expiresAt = now + ADMIN_SESSION_TTL_MS;
	const payload = `v1.${expiresAt}.${randomBase62(16)}`;
	const sig = await hmacSha256Hex(await sessionKey(config), payload);
	return { value: `${payload}.${sig}`, expiresAt };
}

/** True for a session this deployment signed, not expired. Always false in Access mode. */
export async function verifyAdminSession(value: string | null | undefined, config: Config, now = Date.now()): Promise<boolean> {
	if (!value || config.admin.mode !== 'password') return false;
	const parts = value.split('.');
	if (parts.length !== 4) return false;
	const [version, exp, nonce, sig] = parts as [string, string, string, string];
	if (version !== 'v1' || !/^\d{13,}$/.test(exp) || !/^[0-9A-Za-z]{16}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) {
		return false;
	}
	const expiresAt = Number(exp);
	if (expiresAt <= now || expiresAt > now + ADMIN_SESSION_TTL_MS + 60_000) return false;
	const expected = await hmacSha256Hex(await sessionKey(config), `${version}.${exp}.${nonce}`);
	return timingSafeEqual(sig, expected);
}

/** Options for SvelteKit `cookies.set(ADMIN_SESSION_COOKIE, value, …)`. */
export function adminCookieOptions(expiresAt: number, url: URL) {
	// Browsers accept Secure cookies on http://localhost, but not all of them;
	// everywhere else (every real deployment is https) the cookie is Secure.
	const localHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	return {
		path: '/admin',
		httpOnly: true,
		secure: !localHttp,
		sameSite: 'strict' as const,
		expires: new Date(expiresAt)
	};
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get('cookie');
	if (!header) return null;
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === name) {
			try {
				return decodeURIComponent(part.slice(eq + 1).trim());
			} catch {
				return null;
			}
		}
	}
	return null;
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

/** Who is asking, or null. Access mode checks only the JWT; password mode only the cookie. */
export async function authenticateAdmin(
	request: Request,
	config: Config,
	opts: { now?: number; keySet?: JWTVerifyGetKey } = {}
): Promise<AdminIdentity | null> {
	if (config.admin.mode === 'access') {
		const token = request.headers.get('cf-access-jwt-assertion');
		if (!token) return null;
		const verified = await verifyAccessJwt(token, config.admin.access, opts.keySet);
		return verified ? { method: 'access', email: verified.email } : null;
	}
	const ok = await verifyAdminSession(readCookie(request, ADMIN_SESSION_COOKIE), config, opts.now);
	return ok ? { method: 'password' } : null;
}

/** The per-client login counter (IPv4 address or IPv6 /64). */
export function loginRateKey(ip: string | null | undefined): string {
	return `admin-login:ip:${ipRateKey(ip)}`;
}

export type LoginResult =
	| { ok: true; session: { value: string; expiresAt: number } }
	| { ok: false; reason: 'invalid' | 'rate_limited' | 'wrong_mode' };

/**
 * Checks a password login. The per-IP attempt is counted before the password is
 * compared, so a flood of guesses from one address is refused without being
 * checked. The global limit counts only FAILED attempts and never refuses the
 * right password, so junk from many addresses cannot lock the operator out.
 */
export async function loginWithPassword(
	db: DB,
	config: Config,
	input: { password: string; ip: string; now?: number }
): Promise<LoginResult> {
	if (config.admin.mode !== 'password') return { ok: false, reason: 'wrong_mode' };
	const now = input.now ?? Date.now();
	const ipKey = loginRateKey(input.ip);
	const perIp = await consumeRateLimit(db, ipKey, LOGIN_LIMIT_PER_IP, LOGIN_WINDOW_MS, now);
	if (!perIp.ok) return { ok: false, reason: 'rate_limited' };
	if (!(await timingSafeEqual(input.password, config.admin.password))) {
		const global = await consumeRateLimit(db, 'admin-login:failed', LOGIN_LIMIT_GLOBAL, LOGIN_WINDOW_MS, now);
		return { ok: false, reason: global.ok ? 'invalid' : 'rate_limited' };
	}
	await resetRateLimit(db, ipKey);
	return { ok: true, session: await createAdminSession(config, now) };
}
