import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, tryLoadConfig, type Env } from './env';
import { TEST_ADMIN_PASSWORD, TEST_ENCRYPTION_KEY } from './testdb';

const DB = {} as D1Database;

const base: Env = {
	DB,
	ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
	ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
	PUBLIC_ORIGIN: 'https://payments.example.com'
};

const bonum = { BONUM_APP_SECRET: 'secret', BONUM_TERMINAL_ID: 'term', BONUM_CHECKSUM_KEY: 'chk' };
const qpay = { QPAY_CLIENT_ID: 'id', QPAY_CLIENT_PASSWORD: 'pw', QPAY_INVOICE_CODE: 'INV' };

function problems(env: Env): string[] {
	const r = tryLoadConfig(env);
	return r.ok ? [] : r.error.problems;
}

describe('loadConfig: fails closed', () => {
	it('refuses with no admin auth at all', () => {
		expect(() => loadConfig({ ...base, ADMIN_PASSWORD: '' })).toThrow(ConfigError);
		expect(problems({ ...base, ADMIN_PASSWORD: undefined })).toEqual([
			'set ADMIN_PASSWORD, or CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD'
		]);
	});

	it('refuses a short admin password', () => {
		expect(problems({ ...base, ADMIN_PASSWORD: 'short' })).toEqual(['ADMIN_PASSWORD must be at least 12 characters']);
	});

	it('refuses half an Access setup, even with a password', () => {
		expect(problems({ ...base, CF_ACCESS_AUD: 'aud' })).toEqual([
			'CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be set together'
		]);
		expect(problems({ ...base, CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' })).toHaveLength(1);
	});

	it('requires a valid ENCRYPTION_KEY', () => {
		expect(problems({ ...base, ENCRYPTION_KEY: undefined })).toEqual(['ENCRYPTION_KEY is required']);
		expect(problems({ ...base, ENCRYPTION_KEY: btoa('too short') })).toEqual([
			'ENCRYPTION_KEY must be base64 for exactly 32 bytes'
		]);
	});

	it('refuses an unknown provider environment and a non-https origin', () => {
		expect(problems({ ...base, BONUM_ENVIRONMENT: 'staging' })).toEqual([
			'BONUM_ENVIRONMENT must be "production" or "test"'
		]);
		expect(problems({ ...base, PUBLIC_ORIGIN: 'http://payments.example.com' })).toEqual([
			'PUBLIC_ORIGIN must use https://'
		]);
		expect(problems({ ...base, PUBLIC_ORIGIN: 'https://x.example.com/path' })).toHaveLength(1);
	});

	it('never puts secret values in the error', () => {
		const r = tryLoadConfig({ ...base, ADMIN_PASSWORD: 'hunter2', ENCRYPTION_KEY: 'c2VjcmV0LWtleQ==' });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.message).not.toContain('hunter2');
			expect(r.error.message).not.toContain('c2VjcmV0LWtleQ==');
		}
	});
});

describe('loadConfig: admin mode', () => {
	it('uses the password when Access is not set', () => {
		expect(loadConfig(base).admin).toEqual({ mode: 'password', password: TEST_ADMIN_PASSWORD });
	});

	it('prefers Access and ignores the password; normalises the team domain', () => {
		const cfg = loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: 'https://Team.CloudflareAccess.com/', CF_ACCESS_AUD: 'aud123' });
		expect(cfg.admin).toEqual({ mode: 'access', access: { teamDomain: 'team.cloudflareaccess.com', aud: 'aud123' } });
	});

	it('works with Access and no password', () => {
		const cfg = loadConfig({
			...base,
			ADMIN_PASSWORD: undefined,
			CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
			CF_ACCESS_AUD: 'aud'
		});
		expect(cfg.admin.mode).toBe('access');
	});
});

describe('loadConfig: providers', () => {
	it('are off when their secrets are empty', () => {
		const cfg = loadConfig(base);
		expect(cfg.providers).toEqual({ bonum: false, qpay: false });
		expect(cfg.bonum).toBeNull();
		expect(cfg.warnings).toEqual([]);
	});

	it('are on when every secret is set; empty environment means production', () => {
		const cfg = loadConfig({ ...base, ...bonum, ...qpay });
		expect(cfg.providers).toEqual({ bonum: true, qpay: true });
		expect(cfg.bonum).toMatchObject({ environment: 'production', baseUrl: 'https://apis.bonum.mn', terminalId: 'term' });
		expect(cfg.qpay).toMatchObject({ environment: 'production', baseUrl: 'https://merchant.qpay.mn', invoiceCode: 'INV' });
	});

	it('select the sandbox with ENVIRONMENT=test', () => {
		const cfg = loadConfig({ ...base, ...bonum, ...qpay, BONUM_ENVIRONMENT: 'test', QPAY_ENVIRONMENT: 'TEST' });
		expect(cfg.bonum?.baseUrl).toBe('https://testapi.bonum.mn');
		expect(cfg.qpay?.baseUrl).toBe('https://merchant-sandbox.qpay.mn');
	});

	it('a half-configured provider is off with a warning, and the rest keeps working', () => {
		const cfg = loadConfig({ ...base, ...qpay, BONUM_APP_SECRET: 'secret' });
		expect(cfg.providers).toEqual({ bonum: false, qpay: true });
		expect(cfg.warnings).toEqual([
			'Bonum is off: BONUM_APP_SECRET, BONUM_TERMINAL_ID and BONUM_CHECKSUM_KEY must all be set'
		]);
	});

	it('need PUBLIC_ORIGIN for callbacks', () => {
		const cfg = loadConfig({ ...base, ...bonum, PUBLIC_ORIGIN: '' });
		expect(cfg.providers.bonum).toBe(false);
		expect(cfg.publicOrigin).toBeNull();
		expect(cfg.warnings[0]).toContain('PUBLIC_ORIGIN');
	});

	it('trims the origin and allows http://localhost for dev', () => {
		expect(loadConfig({ ...base, PUBLIC_ORIGIN: 'https://pay.example.com/' }).publicOrigin).toBe('https://pay.example.com');
		expect(loadConfig({ ...base, PUBLIC_ORIGIN: 'http://localhost:5173' }).publicOrigin).toBe('http://localhost:5173');
	});
});
