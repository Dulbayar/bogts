/**
 * Which language a public page speaks, in this order:
 *  1. `?lang=` (the picker; the caller stores it in a cookie);
 *  2. that cookie;
 *  3. Cloudflare's `request.cf.country` being `MN` (most Mongolian phones are
 *     set to English, so the country wins over Accept-Language);
 *  4. the best `Accept-Language` match;
 *  5. Mongolian.
 */
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './index';

export const LANG_COOKIE = 'bogts_lang';

/** A BCP 47 tag (`fr-CA`, `zh-CN`, `zh-Hans-SG`) → one of our locales, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
	if (!tag) return null;
	const t = tag.trim().toLowerCase().replace(/_/g, '-');
	if (!t) return null;
	const exact = LOCALES.find((l) => l.toLowerCase() === t);
	if (exact) return exact;
	const [lang, ...rest] = t.split('-');
	if (lang === 'zh') {
		// Simplified Chinese: zh, zh-Hans*, zh-CN, zh-SG. Traditional (Hant, TW, HK, MO) is not offered.
		if (rest.includes('hant') || rest.some((r) => ['tw', 'hk', 'mo'].includes(r))) return null;
		return 'zh-Hans';
	}
	return LOCALES.find((l) => l === lang) ?? null;
}

/** `Accept-Language` → our best match, honouring q-values (q=0 excludes). */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
	if (!header) return null;
	const ranked = header
		.split(',')
		.map((part, i) => {
			const [tag = '', ...params] = part.trim().split(';');
			const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
			const weight = q ? Number(q.slice(2)) : 1;
			return { tag: tag.trim(), q: Number.isFinite(weight) ? weight : 0, i };
		})
		.filter((x) => x.tag && x.tag !== '*' && x.q > 0)
		.sort((a, b) => b.q - a.q || a.i - b.i);
	for (const { tag } of ranked) {
		const m = matchLocale(tag);
		if (m) return m;
	}
	return null;
}

export type LocaleInput = {
	query?: string | null;
	cookie?: string | null;
	country?: string | null;
	acceptLanguage?: string | null;
};

/** The locale, and whether it came from `?lang=` (so the caller remembers it in the cookie). */
export function pickLocale(input: LocaleInput): { locale: Locale; fromQuery: boolean } {
	const q = matchLocale(input.query);
	if (q) return { locale: q, fromQuery: true };
	if (isLocale(input.cookie)) return { locale: input.cookie, fromQuery: false };
	if (input.country?.toUpperCase() === 'MN') return { locale: 'mn', fromQuery: false };
	return { locale: fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE, fromQuery: false };
}
