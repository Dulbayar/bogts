/**
 * The QPay-format QR both providers hand back. QPay's own invoices and Bonum's
 * QR invoices (`qr/create`) answer with the same three things — the QR text, a
 * base64 PNG of it, and a list of bank-app deeplinks — so both are checked here,
 * by one set of rules, rather than trusted.
 */
import type { Deeplink } from './schema';

/** The PNG is about 10 KB from either provider; anything much larger is dropped. */
export const MAX_QR_IMAGE_CHARS = 48 * 1024;
export const MAX_QR_TEXT_CHARS = 2048;
const MAX_DEEPLINKS = 50;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const str = (v: unknown, max: number): string | undefined =>
	typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

/** The QR text, when it is one we would show; null otherwise. */
export function qrText(raw: unknown): string | null {
	return str(raw, MAX_QR_TEXT_CHARS) ?? null;
}

/** Bank-app links (QPay `urls[]`, Bonum `links[]`): scripts, data URLs and non-https logos dropped. */
export function deeplinks(raw: unknown): Deeplink[] {
	if (!Array.isArray(raw)) return [];
	const out: Deeplink[] = [];
	for (const item of raw.slice(0, MAX_DEEPLINKS)) {
		if (!item || typeof item !== 'object') continue;
		const r = item as Record<string, unknown>;
		const name = str(r.name, 200);
		const link = str(r.link, 4096);
		if (!name || !link || /^\s*(javascript|data|vbscript):/i.test(link)) continue;
		const d: Deeplink = { name, link };
		const description = str(r.description, 200);
		const logo = str(r.logo, 2048);
		if (description) d.description = description;
		if (logo && /^https:\/\//i.test(logo)) d.logo = logo;
		out.push(d);
	}
	return out;
}

/** The QR as a base64 PNG, or null when it is missing, too large, or not base64. */
export function qrImage(raw: unknown): string | null {
	if (typeof raw !== 'string' || !raw || raw.length > MAX_QR_IMAGE_CHARS) return null;
	return BASE64.test(raw) ? raw : null;
}
