/**
 * Web Crypto helpers. Everything here works in Workers and in Node >= 24.
 *
 * `encrypt` / `decrypt`: AES-256-GCM with a random 96-bit IV, serialised as
 * `v1.<iv base64>.<ciphertext+tag base64>`. `key` is ENCRYPTION_KEY: 32 bytes,
 * base64 (standard or url-safe alphabet).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CryptoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CryptoError';
	}
}

export function base64Encode(bytes: Uint8Array): string {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export function base64Decode(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
	let binary: string;
	try {
		binary = atob(normalized);
	} catch {
		throw new CryptoError('invalid base64');
	}
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Decodes ENCRYPTION_KEY, or throws if it is not base64 for exactly 32 bytes. */
export function decodeEncryptionKey(key: string): Uint8Array<ArrayBuffer> {
	let bytes: Uint8Array<ArrayBuffer>;
	try {
		bytes = base64Decode(key);
	} catch {
		throw new CryptoError('ENCRYPTION_KEY must be base64');
	}
	if (bytes.byteLength !== 32) throw new CryptoError('ENCRYPTION_KEY must be 32 bytes (base64)');
	return bytes;
}

/** Imported AES keys, per isolate. Keyed by the key text itself; never logged. */
const aesKeys = new Map<string, Promise<CryptoKey>>();

function aesKey(key: string): Promise<CryptoKey> {
	let cached = aesKeys.get(key);
	if (!cached) {
		const bytes = decodeEncryptionKey(key);
		cached = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
		aesKeys.set(key, cached);
	}
	return cached;
}

export async function encrypt(plain: string, key: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), encoder.encode(plain));
	return `v1.${base64Encode(iv)}.${base64Encode(new Uint8Array(ct))}`;
}

export async function decrypt(value: string, key: string): Promise<string> {
	const [version, ivPart, ctPart, extra] = value.split('.');
	if (version !== 'v1' || !ivPart || !ctPart || extra !== undefined) throw new CryptoError('invalid ciphertext');
	const iv = base64Decode(ivPart);
	if (iv.byteLength !== 12) throw new CryptoError('invalid ciphertext');
	try {
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(key), base64Decode(ctPart));
		return decoder.decode(plain);
	} catch {
		// Wrong key or tampered ciphertext: never say which.
		throw new CryptoError('decryption failed');
	}
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

/** HMAC-SHA256 of `message` under the UTF-8 bytes of `key`, as lowercase hex. */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return toHex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

/**
 * Constant-time string comparison. Compares HMACs of both sides under a random
 * per-call key, so neither the contents nor the length of the secret leaks
 * through timing (the early return happens on digests, not on the inputs).
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
	const key = crypto.getRandomValues(new Uint8Array(32));
	const hmacKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const [da, db] = await Promise.all([
		crypto.subtle.sign('HMAC', hmacKey, encoder.encode(a)),
		crypto.subtle.sign('HMAC', hmacKey, encoder.encode(b))
	]);
	const x = new Uint8Array(da);
	const y = new Uint8Array(db);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
	return diff === 0;
}
