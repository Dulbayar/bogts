/**
 * The public pages' languages (/pay, /return and the public error pages; the
 * dashboard stays English). Mongolian is the default. Detection lives in
 * `detect.ts`; strings in one file per language, all with the same keys.
 */
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { mn, type PublicKey, type PublicMessages } from './mn';
import { ru } from './ru';
import { zhHans } from './zh-Hans';

export const LOCALES = ['mn', 'en', 'fr', 'ru', 'zh-Hans', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'mn';

/** Each language's own name, for the picker. */
export const NATIVE_NAMES: Record<Locale, string> = {
	mn: 'Монгол',
	en: 'English',
	fr: 'Français',
	ru: 'Русский',
	'zh-Hans': '简体中文',
	es: 'Español'
};

const MESSAGES: Record<Locale, PublicMessages> = { mn, en, fr, ru, 'zh-Hans': zhHans, es };

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

export type Translate = (key: PublicKey, vars?: Record<string, string | number>) => string;

/** `t(key, vars)` for a language, filling `{name}` placeholders. */
export function translator(locale: Locale): Translate {
	const messages = MESSAGES[locale];
	return (key, vars = {}) => messages[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

/**
 * MNT with the language's digit grouping: `₮49,000`, `₮49 000`, `₮49.000`.
 * Mongolian uses commas (as bank apps do); pinned, since browsers may lack `mn`.
 */
export function formatMoneyIn(locale: Locale, amount: number): string {
	return `${amount < 0 ? '−' : ''}₮${formatAmountIn(locale, Math.abs(amount))}`;
}

/** The bare number, grouped the language's way (`49,000`), for `money.label`, which names the unit itself. */
export function formatAmountIn(locale: Locale, amount: number): string {
	return new Intl.NumberFormat(locale === 'mn' ? 'en-US' : locale, { maximumFractionDigits: 2 }).format(amount);
}

/**
 * A date and time in Ulaanbaatar time, written the language's way. Mongolian
 * is `2026.09.26 14:05`, built by hand: browsers' Intl data often lacks `mn`
 * and falls back to English month names.
 */
export function formatDateTimeIn(locale: Locale, ms: number): string {
	if (locale === 'mn') {
		const parts = Object.fromEntries(
			new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ulaanbaatar', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
				.formatToParts(ms)
				.map((x) => [x.type, x.value])
		);
		return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
	}
	return new Intl.DateTimeFormat(locale, {
		timeZone: 'Asia/Ulaanbaatar',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(ms);
}

/** The 404 title for a URL: a missing invoice (/pay/…, /return/…) is a payment not found; anything else, a page not found. */
export function notFoundTitleKey(pathname: string): PublicKey {
	return /^\/(pay|return)\/[^/]/.test(pathname) ? 'error.notFound.title' : 'error.pageNotFound.title';
}

export type { PublicKey, PublicMessages };
