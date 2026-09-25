/**
 * Bonum HTTP client: `testapi.bonum.mn` or `apis.bonum.mn` (from `config.bonum`).
 *
 * Access tokens: isolate memory → D1 `provider_token` (encrypted with
 * ENCRYPTION_KEY) → refresh → mint. `auth/create` is rate-limited ("Use
 * previous token"), so a token minted by one isolate is shared with every other
 * through D1, and concurrent callers in one isolate share one in-flight fetch.
 * On a 401 the rejected token is never reused: a different fresh token another
 * isolate stored wins over minting again, and the request is retried once.
 *
 * Errors are `BonumError` with a short safe code only. Nothing here logs or
 * returns credentials, tokens, card tokens or provider bodies/messages.
 */
import { eq } from 'drizzle-orm';
import { ApiError } from '../../api/errors';
import { decrypt, encrypt, sha256Hex } from '../../crypto';
import type { BonumConfig } from '../../env';
import { providerToken } from '../../schema';
import { nowOf, type ServiceContext } from '../../services/context';

export const BONUM_TIMEOUT_MS = 15_000;
/** Treat a token as expired this long before Bonum says it is. */
const EXPIRY_MARGIN_MS = 60_000;
const ACCEPT_LANGUAGE = 'mn';

export class BonumError extends Error {
	constructor(
		readonly status: number,
		readonly operation: string,
		/** A short machine code (`timeout`, `http_500`, `rate_limited`, …); never provider free text */
		readonly code: string
	) {
		super(`Bonum ${operation} failed (${status}): ${code}`);
		this.name = 'BonumError';
	}
}

/** The Bonum config, or a 400 `provider_disabled` when Bonum is off in this deployment. */
export function bonumConfigOf(ctx: ServiceContext): BonumConfig {
	const cfg = ctx.config.bonum;
	if (!cfg || !ctx.config.publicOrigin) throw new ApiError(400, 'provider_disabled', 'Bonum is not enabled on this gateway');
	return cfg;
}

/** Maps a BonumError to the API's safe 502 `provider_error`. */
export function providerError(err: unknown): unknown {
	if (err instanceof BonumError) return new ApiError(502, 'provider_error', 'Bonum did not accept the request. Try again.');
	return err;
}

/* ------------------------------------------------------------------ *
 * Access tokens
 * ------------------------------------------------------------------ */

type Token = { accessToken: string; refreshToken: string | null; expiresAt: number; refreshExpiresAt: number | null };

const memory = new Map<string, Token>();
const inflight = new Map<string, Promise<Token>>();

/** Test helper: forget this isolate's tokens (simulates a fresh isolate). */
export function resetBonumTokenCache(): void {
	memory.clear();
	inflight.clear();
}

/** The `provider_token` row key: a hash of environment + terminal + secret, so no secret is stored in it. */
export async function tokenStoreKey(cfg: BonumConfig): Promise<string> {
	return `bonum:${await sha256Hex(`${cfg.environment}|${cfg.terminalId}|${cfg.appSecret}`)}`;
}

async function loadStored(ctx: ServiceContext, key: string): Promise<Token | null> {
	try {
		const [row] = await ctx.db.select().from(providerToken).where(eq(providerToken.key, key)).limit(1);
		if (!row) return null;
		return {
			accessToken: await decrypt(row.accessTokenEnc, ctx.config.encryptionKey),
			refreshToken: row.refreshTokenEnc ? await decrypt(row.refreshTokenEnc, ctx.config.encryptionKey) : null,
			expiresAt: row.expiresAt,
			refreshExpiresAt: row.refreshExpiresAt
		};
	} catch {
		console.warn('[bonum] token store read failed');
		return null;
	}
}

async function saveStored(ctx: ServiceContext, key: string, token: Token): Promise<void> {
	try {
		const values = {
			accessTokenEnc: await encrypt(token.accessToken, ctx.config.encryptionKey),
			refreshTokenEnc: token.refreshToken ? await encrypt(token.refreshToken, ctx.config.encryptionKey) : null,
			expiresAt: token.expiresAt,
			refreshExpiresAt: token.refreshExpiresAt,
			updatedAt: nowOf(ctx)
		};
		await ctx.db
			.insert(providerToken)
			.values({ key, ...values })
			.onConflictDoUpdate({ target: providerToken.key, set: values });
	} catch {
		console.warn('[bonum] token store write failed');
	}
}

async function timedFetch(operation: string, url: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(url, { ...init, signal: AbortSignal.timeout(BONUM_TIMEOUT_MS) });
	} catch (err) {
		const name = err instanceof Error ? err.name : '';
		if (name === 'TimeoutError' || name === 'AbortError') throw new BonumError(504, operation, 'timeout');
		throw new BonumError(502, operation, 'network');
	}
}

function parseToken(body: unknown, now: number): Token | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	if (typeof b.accessToken !== 'string' || !b.accessToken) return null;
	const expiresIn = typeof b.expiresIn === 'number' ? b.expiresIn : 0;
	const refreshIn = typeof b.refreshExpiresIn === 'number' ? b.refreshExpiresIn : 0;
	return {
		accessToken: b.accessToken,
		refreshToken: typeof b.refreshToken === 'string' && b.refreshToken ? b.refreshToken : null,
		expiresAt: now + Math.max(0, expiresIn * 1000 - EXPIRY_MARGIN_MS),
		refreshExpiresAt: refreshIn ? now + Math.max(0, refreshIn * 1000 - EXPIRY_MARGIN_MS) : null
	};
}

async function readJsonBody(response: Response): Promise<unknown> {
	const text = await response.text().catch(() => '');
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

async function mint(ctx: ServiceContext, cfg: BonumConfig, key: string, fresh: (t: Token) => boolean): Promise<Token> {
	const response = await timedFetch('auth/create', `${cfg.baseUrl}/bonum-gateway/ecommerce/auth/create`, {
		method: 'GET',
		headers: {
			Authorization: `AppSecret ${cfg.appSecret}`,
			'X-TERMINAL-ID': cfg.terminalId,
			'Accept-Language': ACCEPT_LANGUAGE,
			Accept: 'application/json'
		}
	});
	if (response.status === 429) {
		// "Use previous token": another isolate may have just minted one.
		await response.body?.cancel().catch(() => {});
		const stored = await loadStored(ctx, key);
		if (stored && fresh(stored)) return stored;
		throw new BonumError(429, 'auth/create', 'rate_limited');
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new BonumError(response.status, 'auth/create', `http_${response.status}`);
	}
	const token = parseToken(await readJsonBody(response), nowOf(ctx));
	if (!token) throw new BonumError(502, 'auth/create', 'invalid_response');
	return token;
}

async function refresh(ctx: ServiceContext, cfg: BonumConfig, current: Token): Promise<Token | null> {
	if (!current.refreshToken) return null;
	try {
		const response = await timedFetch('auth/refresh', `${cfg.baseUrl}/bonum-gateway/ecommerce/auth/refresh`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${current.refreshToken}`,
				'Accept-Language': ACCEPT_LANGUAGE,
				Accept: 'application/json'
			}
		});
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			return null;
		}
		return parseToken(await readJsonBody(response), nowOf(ctx));
	} catch {
		return null;
	}
}

/**
 * A usable access token. `rejected` is a token Bonum just answered 401 to: it
 * is never returned again, and a refresh is skipped (mint instead), unless a
 * different fresh token is already stored.
 */
export async function accessToken(ctx: ServiceContext, rejected?: string): Promise<string> {
	const cfg = bonumConfigOf(ctx);
	const key = await tokenStoreKey(cfg);
	const fresh = (t: Token) => t.expiresAt > nowOf(ctx) && t.accessToken !== rejected;

	const cached = memory.get(key);
	if (cached && fresh(cached)) return cached.accessToken;
	const pending = inflight.get(key);
	if (pending) {
		const t = await pending.catch(() => null);
		if (t && fresh(t)) return t.accessToken;
	}

	const promise = (async () => {
		const stored = await loadStored(ctx, key);
		if (stored && fresh(stored)) return stored;
		const current = stored ?? cached ?? null;
		let token: Token | null = null;
		if (!rejected && current && current.refreshExpiresAt !== null && current.refreshExpiresAt > nowOf(ctx)) {
			token = await refresh(ctx, cfg, current);
		}
		if (!token) {
			token = await mint(ctx, cfg, key, fresh);
			if (token === stored) return token;
		}
		await saveStored(ctx, key, token);
		return token;
	})();
	inflight.set(key, promise);
	try {
		const token = await promise;
		memory.set(key, token);
		return token.accessToken;
	} finally {
		if (inflight.get(key) === promise) inflight.delete(key);
	}
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

export interface BonumRequest {
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
	/** Sent as `X-CARD-TOKEN`; never logged */
	cardToken?: string;
}

export interface BonumResponse {
	status: number;
	/** Parsed JSON; null for an empty body; undefined when the body was not JSON */
	body: unknown;
}

/** A provider message usable as a code: a dotted key like `subscription.process.waiting`, never free text. */
export function messageKey(body: unknown): string | null {
	if (!body || typeof body !== 'object') return null;
	const m = (body as Record<string, unknown>).message;
	return typeof m === 'string' && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(m) && m.length <= 64 ? m : null;
}

/**
 * One call with a Bearer token, retried once with a different token on a 401.
 * Returns the status and parsed body whatever the status: callers that care
 * about specific codes (purchase) read them; `bonumRequest` throws instead.
 */
export async function bonumCall(ctx: ServiceContext, operation: string, path: string, req: BonumRequest = {}): Promise<BonumResponse> {
	const cfg = bonumConfigOf(ctx);
	const send = async (token: string) =>
		timedFetch(operation, `${cfg.baseUrl}${path}`, {
			method: req.method ?? 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				'Accept-Language': ACCEPT_LANGUAGE,
				Accept: 'application/json',
				...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
				...(req.cardToken ? { 'X-CARD-TOKEN': req.cardToken } : {})
			},
			...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {})
		});
	const token = await accessToken(ctx);
	let response = await send(token);
	if (response.status === 401) {
		await response.body?.cancel().catch(() => {});
		response = await send(await accessToken(ctx, token));
	}
	return { status: response.status, body: await readJsonBody(response) };
}

/** `bonumCall` for the usual case: 2xx gives the body, anything else throws `BonumError`. */
export async function bonumRequest<T = unknown>(
	ctx: ServiceContext,
	operation: string,
	path: string,
	req: BonumRequest = {}
): Promise<T> {
	const { status, body } = await bonumCall(ctx, operation, path, req);
	if (status < 200 || status >= 300) throw new BonumError(status, operation, messageKey(body) ?? `http_${status}`);
	if (body === undefined) throw new BonumError(502, operation, 'invalid_json');
	return body as T;
}

/** Bonum wraps most answers in `{ data }`; some (invoices, tokenize) are bare. */
export function unwrap(body: unknown): Record<string, unknown> {
	if (!body || typeof body !== 'object') return {};
	const b = body as Record<string, unknown>;
	if (b.data && typeof b.data === 'object' && !Array.isArray(b.data)) return b.data as Record<string, unknown>;
	return b;
}
