import { describe, expect, it } from 'vitest';
import {
	CryptoError,
	base64Encode,
	decodeEncryptionKey,
	decrypt,
	encrypt,
	hmacSha256Hex,
	sha256Hex,
	timingSafeEqual
} from './crypto';
import { TEST_ENCRYPTION_KEY } from './testdb';

const OTHER_KEY = base64Encode(new Uint8Array(32).fill(2));

describe('encrypt / decrypt', () => {
	it('round-trips, including non-ASCII text', async () => {
		const ct = await encrypt('карт токен ✓ 1fc53f93', TEST_ENCRYPTION_KEY);
		expect(ct).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
		expect(await decrypt(ct, TEST_ENCRYPTION_KEY)).toBe('карт токен ✓ 1fc53f93');
	});

	it('uses a fresh IV every time', async () => {
		const a = await encrypt('same', TEST_ENCRYPTION_KEY);
		const b = await encrypt('same', TEST_ENCRYPTION_KEY);
		expect(a).not.toBe(b);
	});

	it('accepts the url-safe base64 alphabet for the key', async () => {
		const bytes = new Uint8Array(32).fill(0xfb); // encodes with + and /
		const std = base64Encode(bytes);
		const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_');
		expect(std).toMatch(/[+/]/);
		expect(await decrypt(await encrypt('x', std), urlSafe)).toBe('x');
	});

	it('refuses the wrong key without saying why', async () => {
		const ct = await encrypt('secret', TEST_ENCRYPTION_KEY);
		await expect(decrypt(ct, OTHER_KEY)).rejects.toThrow(new CryptoError('decryption failed'));
	});

	it('refuses tampered ciphertext', async () => {
		const ct = await encrypt('secret', TEST_ENCRYPTION_KEY);
		const [v, iv, body] = ct.split('.') as [string, string, string];
		const flipped = body.startsWith('A') ? `B${body.slice(1)}` : `A${body.slice(1)}`;
		await expect(decrypt(`${v}.${iv}.${flipped}`, TEST_ENCRYPTION_KEY)).rejects.toThrow(CryptoError);
	});

	it('refuses malformed values', async () => {
		for (const bad of ['', 'v1', 'v2.a.b', 'v1.a', 'v1.AAAA.AAAA', 'v1.a.b.c']) {
			await expect(decrypt(bad, TEST_ENCRYPTION_KEY)).rejects.toThrow(CryptoError);
		}
	});
});

describe('decodeEncryptionKey', () => {
	it('requires exactly 32 bytes of base64', () => {
		expect(decodeEncryptionKey(TEST_ENCRYPTION_KEY).byteLength).toBe(32);
		expect(() => decodeEncryptionKey(base64Encode(new Uint8Array(16)))).toThrow(CryptoError);
		expect(() => decodeEncryptionKey('not base64!!')).toThrow(CryptoError);
		expect(() => decodeEncryptionKey('')).toThrow(CryptoError);
	});
});

describe('hashes', () => {
	it('sha256Hex matches the known vector', async () => {
		expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});

	it('hmacSha256Hex matches RFC 4231 test case 2', async () => {
		expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
			'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
		);
	});

	it('timingSafeEqual compares exactly', async () => {
		expect(await timingSafeEqual('abc', 'abc')).toBe(true);
		expect(await timingSafeEqual('abc', 'abd')).toBe(false);
		expect(await timingSafeEqual('abc', 'abcd')).toBe(false);
		expect(await timingSafeEqual('', '')).toBe(true);
	});
});
