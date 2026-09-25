/**
 * Configuration: the Worker's bindings and secrets, validated once per request.
 *
 * `loadConfig` fails closed. It throws `ConfigError` (listing variable NAMES,
 * never values) when the deployment must not serve: no ENCRYPTION_KEY, no admin
 * auth, a half-configured Access, an unknown environment name. `hooks.server.ts`
 * turns that into a 503 for `/v1`, `/admin` and `/hooks`.
 *
 * A provider is enabled only when every one of its secrets is present and
 * PUBLIC_ORIGIN is set. A provider with some but not all secrets is switched
 * off and reported in `warnings`, rather than taking the whole gateway down.
 */
import { decodeEncryptionKey } from './crypto';

/** The Worker bindings (wrangler.jsonc) and secrets (.dev.vars.example). */
export interface Env {
	DB: D1Database;
	ASSETS?: Fetcher;

	BONUM_ENVIRONMENT?: string;
	BONUM_APP_SECRET?: string;
	BONUM_TERMINAL_ID?: string;
	BONUM_CHECKSUM_KEY?: string;

	QPAY_ENVIRONMENT?: string;
	QPAY_CLIENT_ID?: string;
	QPAY_CLIENT_PASSWORD?: string;
	QPAY_INVOICE_CODE?: string;

	ENCRYPTION_KEY?: string;
	ADMIN_PASSWORD?: string;
	PUBLIC_ORIGIN?: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
}

export type ProviderEnvironment = 'test' | 'production';

export interface BonumConfig {
	environment: ProviderEnvironment;
	/** `https://apis.bonum.mn` or `https://testapi.bonum.mn` */
	baseUrl: string;
	appSecret: string;
	terminalId: string;
	checksumKey: string;
}

export interface QpayConfig {
	environment: ProviderEnvironment;
	/** Bare host, `https://merchant.qpay.mn` or `https://merchant-sandbox.qpay.mn`; qpay-js adds `/v2`. */
	baseUrl: string;
	clientId: string;
	clientPassword: string;
	invoiceCode: string;
}

export interface AccessConfig {
	/** `team.cloudflareaccess.com`: no scheme, no trailing slash */
	teamDomain: string;
	aud: string;
}

/**
 * How `/admin` is protected. Access wins when configured; the password is then
 * ignored, so it can never be used to go around Access.
 */
export type AdminAuthConfig = { mode: 'access'; access: AccessConfig } | { mode: 'password'; password: string };

export interface Config {
	/** `https://payments.example.com`, no trailing slash; null when unset (providers are then off) */
	publicOrigin: string | null;
	/** ENCRYPTION_KEY, validated: base64 for exactly 32 bytes */
	encryptionKey: string;
	admin: AdminAuthConfig;
	bonum: BonumConfig | null;
	qpay: QpayConfig | null;
	providers: { bonum: boolean; qpay: boolean };
	/** Non-fatal problems, as safe text naming variables only (e.g. a provider switched off). */
	warnings: string[];
}

export class ConfigError extends Error {
	constructor(readonly problems: string[]) {
		super(`Bogts is not configured: ${problems.join('; ')}`);
		this.name = 'ConfigError';
	}
}

export const ADMIN_PASSWORD_MIN_LENGTH = 12;

const BONUM_URLS: Record<ProviderEnvironment, string> = {
	production: 'https://apis.bonum.mn',
	test: 'https://testapi.bonum.mn'
};

const QPAY_URLS: Record<ProviderEnvironment, string> = {
	production: 'https://merchant.qpay.mn',
	test: 'https://merchant-sandbox.qpay.mn'
};

const value = (v: string | undefined): string => (v ?? '').trim();

/**
 * Empty means production: a deploy that forgot the setting must not quietly
 * take sandbox "payments" for real goods. Anything else unknown is fatal.
 */
function parseEnvironment(name: string, raw: string | undefined, problems: string[]): ProviderEnvironment {
	const v = value(raw).toLowerCase();
	if (v === '' || v === 'production') return 'production';
	if (v === 'test' || v === 'sandbox') return 'test';
	problems.push(`${name} must be "production" or "test"`);
	return 'production';
}

function parseOrigin(raw: string | undefined, problems: string[]): string | null {
	const v = value(raw).replace(/\/+$/, '');
	if (!v) return null;
	let url: URL;
	try {
		url = new URL(v);
	} catch {
		problems.push('PUBLIC_ORIGIN must be a URL like https://payments.example.com');
		return null;
	}
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
		problems.push('PUBLIC_ORIGIN must use https://');
		return null;
	}
	if (url.pathname !== '/' || url.search || url.hash) {
		problems.push('PUBLIC_ORIGIN must be an origin only, without a path');
		return null;
	}
	return url.origin;
}

function normalizeTeamDomain(raw: string): string {
	return raw
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
}

/** Which of a provider's secrets are set: 'all', 'none' or 'some'. */
function presence(values: string[]): 'all' | 'none' | 'some' {
	const set = values.filter(Boolean).length;
	return set === values.length ? 'all' : set === 0 ? 'none' : 'some';
}

export function loadConfig(env: Env): Config {
	const problems: string[] = [];
	const warnings: string[] = [];

	/* ---- encryption key: required ---------------------------------------- */
	const encryptionKey = value(env.ENCRYPTION_KEY);
	if (!encryptionKey) problems.push('ENCRYPTION_KEY is required');
	else {
		try {
			decodeEncryptionKey(encryptionKey);
		} catch {
			problems.push('ENCRYPTION_KEY must be base64 for exactly 32 bytes');
		}
	}

	/* ---- admin auth: Access, else password, else refuse ------------------ */
	let admin: AdminAuthConfig | null = null;
	const teamDomain = normalizeTeamDomain(value(env.CF_ACCESS_TEAM_DOMAIN));
	const aud = value(env.CF_ACCESS_AUD);
	const password = env.ADMIN_PASSWORD ?? '';
	if (teamDomain && aud) {
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(teamDomain)) {
			problems.push('CF_ACCESS_TEAM_DOMAIN must be a host like team.cloudflareaccess.com');
		} else admin = { mode: 'access', access: { teamDomain, aud } };
	} else if (teamDomain || aud) {
		// Half an Access setup is a mistake, not a request for password mode.
		problems.push('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set together');
	} else if (password) {
		if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
			problems.push(`ADMIN_PASSWORD must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`);
		} else admin = { mode: 'password', password };
	} else {
		problems.push('set ADMIN_PASSWORD, or CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD');
	}

	const publicOrigin = parseOrigin(env.PUBLIC_ORIGIN, problems);

	/* ---- providers ------------------------------------------------------- */
	const bonumEnv = parseEnvironment('BONUM_ENVIRONMENT', env.BONUM_ENVIRONMENT, problems);
	const bonumSecrets = [value(env.BONUM_APP_SECRET), value(env.BONUM_TERMINAL_ID), value(env.BONUM_CHECKSUM_KEY)];
	let bonum: BonumConfig | null = null;
	const bonumSet = presence(bonumSecrets);
	if (bonumSet === 'some') {
		warnings.push('Bonum is off: BONUM_APP_SECRET, BONUM_TERMINAL_ID and BONUM_CHECKSUM_KEY must all be set');
	} else if (bonumSet === 'all' && !publicOrigin) {
		warnings.push('Bonum is off: PUBLIC_ORIGIN is required for its callbacks');
	} else if (bonumSet === 'all') {
		const [appSecret, terminalId, checksumKey] = bonumSecrets as [string, string, string];
		bonum = { environment: bonumEnv, baseUrl: BONUM_URLS[bonumEnv], appSecret, terminalId, checksumKey };
	}

	const qpayEnv = parseEnvironment('QPAY_ENVIRONMENT', env.QPAY_ENVIRONMENT, problems);
	const qpaySecrets = [value(env.QPAY_CLIENT_ID), value(env.QPAY_CLIENT_PASSWORD), value(env.QPAY_INVOICE_CODE)];
	let qpay: QpayConfig | null = null;
	const qpaySet = presence(qpaySecrets);
	if (qpaySet === 'some') {
		warnings.push('QPay is off: QPAY_CLIENT_ID, QPAY_CLIENT_PASSWORD and QPAY_INVOICE_CODE must all be set');
	} else if (qpaySet === 'all' && !publicOrigin) {
		warnings.push('QPay is off: PUBLIC_ORIGIN is required for its callbacks');
	} else if (qpaySet === 'all') {
		const [clientId, clientPassword, invoiceCode] = qpaySecrets as [string, string, string];
		qpay = { environment: qpayEnv, baseUrl: QPAY_URLS[qpayEnv], clientId, clientPassword, invoiceCode };
	}

	if (problems.length || !admin) throw new ConfigError(problems);

	return {
		publicOrigin,
		encryptionKey,
		admin,
		bonum,
		qpay,
		providers: { bonum: bonum !== null, qpay: qpay !== null },
		warnings
	};
}

/** `loadConfig` without the throw: for places that report rather than refuse (health, cron). */
export function tryLoadConfig(env: Env): { ok: true; config: Config } | { ok: false; error: ConfigError } {
	try {
		return { ok: true, config: loadConfig(env) };
	} catch (err) {
		if (err instanceof ConfigError) return { ok: false, error: err };
		throw err;
	}
}
