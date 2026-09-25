import { describe, expect, it } from 'vitest';
import { fromAcceptLanguage, matchLocale, pickLocale } from './detect';
import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { formatMoneyIn, LOCALES } from './index';
import { mn } from './mn';
import { ru } from './ru';
import { zhHans } from './zh-Hans';

describe('matchLocale', () => {
	it.each([
		['mn', 'mn'],
		['mn-MN', 'mn'],
		['EN-us', 'en'],
		['fr-CA', 'fr'],
		['ru', 'ru'],
		['es-419', 'es'],
		['zh', 'zh-Hans'],
		['zh-CN', 'zh-Hans'],
		['zh-Hans-SG', 'zh-Hans'],
		['zh-hans', 'zh-Hans'],
		['zh-TW', null],
		['zh-Hant', null],
		['de', null],
		['', null],
		[null, null]
	])('%s → %s', (tag, want) => {
		expect(matchLocale(tag)).toBe(want);
	});
});

describe('fromAcceptLanguage', () => {
	it('takes the highest q-value we support', () => {
		expect(fromAcceptLanguage('de-DE,de;q=0.9,ru;q=0.8,en;q=0.7')).toBe('ru');
		expect(fromAcceptLanguage('en;q=0.5, fr;q=0.9')).toBe('fr');
	});
	it('keeps header order between equal weights', () => {
		expect(fromAcceptLanguage('es, en')).toBe('es');
	});
	it('ignores q=0, wildcards and unknown languages', () => {
		expect(fromAcceptLanguage('fr;q=0, *')).toBeNull();
		expect(fromAcceptLanguage('de, ja')).toBeNull();
		expect(fromAcceptLanguage(null)).toBeNull();
	});
	it('skips Traditional Chinese for the next choice', () => {
		expect(fromAcceptLanguage('zh-TW, en;q=0.8')).toBe('en');
	});
});

describe('pickLocale', () => {
	it('?lang= wins and is flagged for the cookie', () => {
		expect(pickLocale({ query: 'fr', cookie: 'ru', country: 'MN', acceptLanguage: 'en' })).toEqual({ locale: 'fr', fromQuery: true });
	});
	it('an unknown ?lang= falls through to the cookie', () => {
		expect(pickLocale({ query: 'xx', cookie: 'ru' })).toEqual({ locale: 'ru', fromQuery: false });
	});
	it('the cookie wins over the country and the browser', () => {
		expect(pickLocale({ cookie: 'es', country: 'MN', acceptLanguage: 'en' }).locale).toBe('es');
	});
	it('a bad cookie is ignored', () => {
		expect(pickLocale({ cookie: 'klingon', acceptLanguage: 'ru' }).locale).toBe('ru');
	});
	it('country MN wins over an English phone', () => {
		expect(pickLocale({ country: 'MN', acceptLanguage: 'en-US,en;q=0.9' }).locale).toBe('mn');
		expect(pickLocale({ country: 'mn', acceptLanguage: 'en' }).locale).toBe('mn');
	});
	it('outside Mongolia, the browser language counts', () => {
		expect(pickLocale({ country: 'FR', acceptLanguage: 'fr-FR,fr;q=0.9' }).locale).toBe('fr');
		expect(pickLocale({ country: 'CN', acceptLanguage: 'zh-CN,zh;q=0.9' }).locale).toBe('zh-Hans');
	});
	it('falls back to Mongolian', () => {
		expect(pickLocale({})).toEqual({ locale: 'mn', fromQuery: false });
		expect(pickLocale({ country: 'DE', acceptLanguage: 'de' }).locale).toBe('mn');
	});
});

describe('messages', () => {
	const all = { mn, en, fr, ru, 'zh-Hans': zhHans, es };
	it('every language has every key, none empty, same placeholders', () => {
		const keys = Object.keys(mn).sort();
		const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).filter((v) => v !== '{name}').sort();
		for (const [lang, messages] of Object.entries(all)) {
			expect(Object.keys(messages).sort(), lang).toEqual(keys);
			for (const [key, value] of Object.entries(messages)) {
				expect(value.trim(), `${lang} ${key}`).not.toBe('');
				// {name} may be left out (Mongolian avoids case endings on it); other placeholders must match English.
				expect(vars(value), `${lang} ${key}`).toEqual(vars(en[key as keyof typeof en]));
			}
		}
		expect(Object.keys(all).sort()).toEqual([...LOCALES].sort());
	});
});

describe('formatMoneyIn', () => {
	it('uses the tugrik sign with each language’s grouping', () => {
		expect(formatMoneyIn('en', 49000)).toBe('₮49,000');
		expect(formatMoneyIn('fr', 49000)).toMatch(/^₮49\s000$/u);
		expect(formatMoneyIn('ru', 49000)).toMatch(/^₮49\s000$/u);
		expect(formatMoneyIn('en', 0.01)).toBe('₮0.01');
		expect(formatMoneyIn('mn', 1234500)).toMatch(/^₮1.234.500$/);
	});
});
