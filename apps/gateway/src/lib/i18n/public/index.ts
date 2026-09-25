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

/** MNT with the language's digit grouping: `₮49,000`, `₮49 000`, `₮49.000`. */
export function formatMoneyIn(locale: Locale, amount: number): string {
	const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Math.abs(amount));
	return `${amount < 0 ? '−' : ''}₮${n}`;
}

/** A date and time in Ulaanbaatar time, written the language's way. */
export function formatDateTimeIn(locale: Locale, ms: number): string {
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

export type { PublicKey, PublicMessages };
