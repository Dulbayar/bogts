/**
 * Bonum's `x-checksum-v2`: HMAC-SHA256 (hex) of the JSON body under the
 * merchant checksum key.
 *
 * Bonum's reference code (Kotlin) signs the body re-serialized "with no
 * indentation", so the exact text signed is not guaranteed to be the bytes on
 * the wire. Three forms are accepted, all under the same key:
 *  1. the raw bytes, as received;
 *  2. the raw text with whitespace outside strings removed, keeping every
 *     number exactly as sent (`10000.00` stays `10000.00`);
 *  3. `JSON.stringify(JSON.parse(raw))` (numbers normalised: `10000.00` → `10000`).
 * Form 2 is the fix for decimal amounts (docs/providers/bonum-pitfalls.md #4): form 3
 * alone fails for every body Bonum pretty-prints with a decimal amount.
 */
import { hmacSha256Hex, timingSafeEqual } from '../../crypto';

/** Removes JSON whitespace outside string literals; everything else is kept byte for byte. */
export function compactJson(raw: string): string {
	let out = '';
	let inString = false;
	let escaped = false;
	for (const ch of raw) {
		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
		} else if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') out += ch;
	}
	return out;
}

/** The candidate texts Bonum may have signed, deduplicated. */
export function checksumForms(raw: string): string[] {
	const forms = [raw, compactJson(raw)];
	try {
		forms.push(JSON.stringify(JSON.parse(raw)));
	} catch {
		// Not JSON: only the byte forms can match (and parsing will refuse it later).
	}
	return [...new Set(forms)];
}

export function bonumChecksum(text: string, key: string): Promise<string> {
	return hmacSha256Hex(key, text);
}

/** True when `header` is the HMAC of one of the accepted forms. Constant-time per comparison. */
export async function verifyBonumChecksum(raw: string, header: string | null, key: string): Promise<boolean> {
	const given = (header ?? '').trim().toLowerCase();
	if (!key || !/^[0-9a-f]{64}$/.test(given)) return false;
	let ok = false;
	for (const form of checksumForms(raw)) {
		// Evaluate every form (no early exit) so timing does not reveal which matched.
		if (await timingSafeEqual(await bonumChecksum(form, key), given)) ok = true;
	}
	return ok;
}
