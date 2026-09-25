/**
 * QPay v2 over `qpay-js` (pinned to exactly 1.0.0; read its dist before bumping).
 *
 * qpay-js does the HTTP; this file adds what a Worker needs around it:
 *
 *  - TOKENS SHARED ACROSS ISOLATES. qpay-js keeps its token on the client
 *    instance, so a cold isolate would mint a new one per request. Tokens go
 *    memory → D1 `provider_token` (encrypted) → refresh → mint, like Bonum's.
 *    The token we hold is injected into a fresh `QPayClient` per call through
 *    its (runtime-visible, TS-private) `storeToken`. That is the one reach into
 *    qpay-js internals, and the 1.0.0 pin is what makes it safe.
 *  - 401. A token QPay stops accepting early is dropped, and the call is retried
 *    ONCE with another isolate's fresh token or a new one.
 *  - SAFE ERRORS. qpay-js puts QPay's raw body into `Error.message`. Everything
 *    leaving this file is a `QpayCallError` with an HTTP status, QPay's short
 *    error code (`INVOICE_NOTFOUND`) and our operation name. Never a body.
 *
 * QPay's `expires_in` / `refresh_expires_in` are ABSOLUTE epoch seconds
 * (checked against the sandbox on 2026-09-25: both ≈ now + 24 h), which is also
 * how qpay-js reads them.
 *
 * NOTHING HERE LOGS a token, the client password or a response body.
 */
import { and, eq } from 'drizzle-orm';
import { QPayClient, QPayError, type TokenResponse } from 'qpay-js';
import { decrypt, encrypt, sha256Hex } from '../../crypto';
import type { QpayConfig } from '../../env';
import { providerToken } from '../../schema';
import type { ServiceContext } from '../../services/context';

export class QpayCallError extends Error {
	constructor(
		/** HTTP status QPay answered with; 0 when the request never got an answer */
		readonly status: number,
		/** QPay's short error code, or `http_<status>` / `network_error` / `bad_response` */
		readonly code: string,
		readonly operation: string
	) {
		super(`QPay ${operation} failed (${status} ${code})`);
		this.name = 'QpayCallError';
	}
}

type Token = { accessToken: string; refreshToken: string; expiresAt: number; refreshExpiresAt: number };

/** A token is used only while it has this much life left, so qpay-js never refreshes on its own. */
const TOKEN_MARGIN_MS = 60_000;

const memory = new Map<string, Token>();
const pending = new Map<string, Promise<Token>>();

/** Tests only: forget every token this isolate holds. */
export function resetQpayTokenCache(): void {
	memory.clear();
	pending.clear();
}

const usable = (t: Token | undefined, rejected?: string): t is Token =>
	!!t && t.expiresAt - TOKEN_MARGIN_MS > Date.now() && t.accessToken !== rejected;

const refreshable = (t: Token | undefined): t is Token =>
	!!t && !!t.refreshToken && t.refreshExpiresAt - TOKEN_MARGIN_MS > Date.now();

/** QPay sends absolute epoch seconds; accept relative seconds or ms too, defensively. */
function toEpochMs(value: unknown): number {
	const n = typeof value === 'string' ? Number(value) : value;
	if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
	if (n > 1e11) return n; // already ms
	if (n > 1e9) return n * 1000; // epoch seconds (QPay)
	return Date.now() + n * 1000; // relative seconds
}

function fromResponse(res: TokenResponse | undefined): Token {
	if (!res || typeof res.accessToken !== 'string' || !res.accessToken) {
		throw new QpayCallError(200, 'bad_response', 'auth/token');
	}
	const expiresAt = toEpochMs(res.expiresIn);
	return {
		accessToken: res.accessToken,
		refreshToken: typeof res.refreshToken === 'string' ? res.refreshToken : '',
		// No readable expiry: trust it for five minutes rather than forever.
		expiresAt: expiresAt || Date.now() + 5 * 60_000,
		refreshExpiresAt: toEpochMs(res.refreshExpiresIn)
	};
}

/** Puts our token into a qpay-js client (the TS-private `storeToken`, see header). */
function inject(client: QPayClient, t: Token): void {
	(client as unknown as { storeToken(t: Partial<TokenResponse>): void }).storeToken({
		accessToken: t.accessToken,
		refreshToken: t.refreshToken,
		expiresIn: Math.floor(t.expiresAt / 1000),
		refreshExpiresIn: Math.floor(t.refreshExpiresAt / 1000)
	});
}

function newClient(cfg: QpayConfig): QPayClient {
	return new QPayClient({
		baseUrl: cfg.baseUrl.replace(/\/+$/, '').replace(/\/v2$/, ''),
		username: cfg.clientId,
		password: cfg.clientPassword,
		invoiceCode: cfg.invoiceCode,
		// Unused by the client; every invoice carries its own callback_url.
		callbackUrl: ''
	});
}

function requireQpay(ctx: ServiceContext): QpayConfig {
	const cfg = ctx.config.qpay;
	if (!cfg) throw new QpayCallError(0, 'not_configured', 'config');
	return cfg;
}

/** Stable, secret-free row key: `qpay:<sha256(base url | client id)>`. */
async function storeKey(cfg: QpayConfig): Promise<string> {
	return `qpay:${await sha256Hex(`${cfg.baseUrl}|${cfg.clientId}`)}`;
}

async function loadStored(ctx: ServiceContext, key: string): Promise<Token | undefined> {
	try {
		const [row] = await ctx.db.select().from(providerToken).where(eq(providerToken.key, key)).limit(1);
		if (!row) return undefined;
		return {
			accessToken: await decrypt(row.accessTokenEnc, ctx.config.encryptionKey),
			refreshToken: row.refreshTokenEnc ? await decrypt(row.refreshTokenEnc, ctx.config.encryptionKey) : '',
			expiresAt: row.expiresAt,
			refreshExpiresAt: row.refreshExpiresAt ?? 0
		};
	} catch {
		console.warn('[qpay] token store read failed');
		return undefined;
	}
}

async function saveStored(ctx: ServiceContext, key: string, t: Token): Promise<void> {
	try {
		const row = {
			accessTokenEnc: await encrypt(t.accessToken, ctx.config.encryptionKey),
			refreshTokenEnc: t.refreshToken ? await encrypt(t.refreshToken, ctx.config.encryptionKey) : null,
			expiresAt: t.expiresAt,
			refreshExpiresAt: t.refreshExpiresAt || null,
			updatedAt: Date.now()
		};
		await ctx.db
			.insert(providerToken)
			.values({ key, ...row })
			.onConflictDoUpdate({ target: providerToken.key, set: row });
	} catch {
		console.warn('[qpay] token store write failed');
	}
}

async function dropStored(ctx: ServiceContext, key: string, accessToken: string): Promise<void> {
	try {
		const stored = await loadStored(ctx, key);
		if (stored?.accessToken === accessToken) {
			await ctx.db
				.delete(providerToken)
				.where(and(eq(providerToken.key, key), eq(providerToken.expiresAt, stored.expiresAt)));
		}
	} catch {
		/* a stale row is only a wasted 401 later */
	}
}

/** D1, else refresh, else mint. `rejected` is an access token QPay just refused. */
async function obtain(ctx: ServiceContext, cfg: QpayConfig, key: string, rejected?: string): Promise<Token> {
	const stored = await loadStored(ctx, key);
	if (usable(stored, rejected)) return stored;
	const client = newClient(cfg);
	let token: Token | undefined;
	const base = [stored, memory.get(key)].find(refreshable);
	if (base) {
		try {
			inject(client, base);
			token = fromResponse(await client.refreshToken());
		} catch {
			token = undefined; // fall through to a fresh mint
		}
	}
	if (!token) {
		try {
			token = fromResponse(await client.getToken());
		} catch (err) {
			throw sanitize(err, 'auth/token');
		}
	}
	await saveStored(ctx, key, token);
	return token;
}

async function accessToken(ctx: ServiceContext, cfg: QpayConfig, rejected?: string): Promise<Token> {
	const key = await storeKey(cfg);
	const cached = memory.get(key);
	if (usable(cached, rejected)) return cached;
	const inFlight = pending.get(key);
	if (inFlight) {
		const t = await inFlight.catch(() => undefined);
		if (usable(t, rejected)) return t;
	}
	const promise = obtain(ctx, cfg, key, rejected);
	pending.set(key, promise);
	try {
		const t = await promise;
		memory.set(key, t);
		return t;
	} finally {
		if (pending.get(key) === promise) pending.delete(key);
	}
}

const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/;

/** Anything qpay-js (or fetch) throws, as a body-free `QpayCallError`. */
export function sanitize(err: unknown, operation: string): QpayCallError {
	if (err instanceof QpayCallError) return err;
	if (err instanceof QPayError) {
		const code = SAFE_CODE.test(err.code) ? err.code : `http_${err.statusCode}`;
		return new QpayCallError(err.statusCode, code, operation);
	}
	if (err instanceof SyntaxError) return new QpayCallError(200, 'bad_response', operation);
	return new QpayCallError(0, 'network_error', operation);
}

/**
 * One QPay API call with a cached token. A 401 drops that token and retries
 * once. Throws `QpayCallError` only.
 */
export async function qpayCall<T>(
	ctx: ServiceContext,
	operation: string,
	fn: (client: QPayClient) => Promise<T>
): Promise<T> {
	const cfg = requireQpay(ctx);
	const clientWith = (token: Token) => {
		const client = newClient(cfg);
		inject(client, token);
		return client;
	};
	try {
		const token = await accessToken(ctx, cfg);
		try {
			return await fn(clientWith(token));
		} catch (err) {
			if (!(err instanceof QPayError) || err.statusCode !== 401) throw err;
			const key = await storeKey(cfg);
			if (memory.get(key)?.accessToken === token.accessToken) memory.delete(key);
			await dropStored(ctx, key, token.accessToken);
			return await fn(clientWith(await accessToken(ctx, cfg, token.accessToken)));
		}
	} catch (err) {
		throw sanitize(err, operation);
	}
}
