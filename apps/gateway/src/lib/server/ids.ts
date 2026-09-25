import { monotonicFactory } from 'ulid';

/**
 * Every primary key in the system is a ULID: sortable by creation time and
 * URL-safe. Monotonic within an isolate, so two ids minted in the same
 * millisecond (an event and the next one, say) still sort in creation order,
 * which the `GET /v1/events?after=<id>` feed relies on.
 */
const ulid = monotonicFactory();
export const newId = (): string => ulid();

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** `length` characters from [0-9A-Za-z], uniformly (rejection sampling, no modulo bias). */
export function randomBase62(length: number): string {
	let out = '';
	while (out.length < length) {
		const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
		for (const b of bytes) {
			// 248 = 62 * 4: bytes at or above it would bias the first 8 symbols.
			if (b < 248) out += BASE62[b % 62];
			if (out.length === length) break;
		}
	}
	return out;
}

export const API_KEY_PREFIX = 'bgk_';
export const WEBHOOK_SECRET_PREFIX = 'bgwh_';
export const API_KEY_PATTERN = /^bgk_[0-9A-Za-z]{32}$/;
export const WEBHOOK_SECRET_PATTERN = /^bgwh_[0-9A-Za-z]{32}$/;

/** A project API key: `bgk_<32 base62>` (~190 bits). Shown once; only its hash is stored. */
export const newApiKey = (): string => API_KEY_PREFIX + randomBase62(32);

/** A project webhook signing secret: `bgwh_<32 base62>`. Stored encrypted. */
export const newWebhookSecret = (): string => WEBHOOK_SECRET_PREFIX + randomBase62(32);

/** The non-secret part of an API key the dashboard shows: `bgk_` + 8 characters. */
export const apiKeyDisplayPrefix = (key: string): string => key.slice(0, API_KEY_PREFIX.length + 8);
