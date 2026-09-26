import { describe, expect, it } from 'vitest';
import { accentReport, brandVars, contrast, DEFAULT_ACCENT, isPlainEmail, mailtoHref, normalizeHex, palette, SURFACES } from './brand';

describe('normalizeHex', () => {
	it.each([
		['#0E7C7B', '#0e7c7b'],
		['0e7c7b', '#0e7c7b'],
		['#abc', '#aabbcc'],
		[' #ABCDEF ', '#abcdef'],
		['red', null],
		['#12345', null],
		['', null],
		[null, null]
	])('%s → %s', (input, want) => {
		expect(normalizeHex(input)).toBe(want);
	});
});

describe('palette', () => {
	const colours = ['#0e7c7b', '#ffd400', '#ffffff', '#000000', '#1a1a1a', '#e11d48', '#3451d1', '#7fffd4', '#808080'];

	it.each(colours)('%s stays AA in light and dark', (c) => {
		const p = palette(c);
		// Text on the accent fill.
		expect(contrast(p.light.accent, p.light.onAccent)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(p.dark.accent, p.dark.onAccent)).toBeGreaterThanOrEqual(4.5);
		// Links and accent text on the page and card backgrounds.
		expect(contrast(p.light.accentText, SURFACES.light.card)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(p.light.accentText, SURFACES.light.page)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(p.dark.accentText, SURFACES.dark.card)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(p.dark.accentText, SURFACES.dark.page)).toBeGreaterThanOrEqual(4.5);
		// The fill itself stands out from the card (non-text contrast).
		expect(contrast(p.light.accent, SURFACES.light.card)).toBeGreaterThanOrEqual(3);
		expect(contrast(p.dark.accent, SURFACES.dark.card)).toBeGreaterThanOrEqual(3);
		// Hover keeps the label readable.
		expect(contrast(p.light.accentHover, p.light.onAccent)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(p.dark.accentHover, p.dark.onAccent)).toBeGreaterThanOrEqual(4.5);
	});

	it('keeps a colour that already passes', () => {
		expect(palette('#0e7c7b').light.accent).toBe('#0e7c7b');
	});

	it('darkens a light brand colour for light mode and uses ink on it', () => {
		const p = palette('#ffd400');
		expect(p.light.accent).not.toBe('#ffd400');
		expect(p.dark.accent).toBe('#ffd400');
		expect(p.dark.onAccent).not.toBe('#ffffff');
	});

	it('falls back to the Bogts blue', () => {
		expect(palette(null)).toEqual(palette(DEFAULT_ACCENT));
		expect(palette('nonsense')).toEqual(palette(DEFAULT_ACCENT));
	});
});

describe('brandVars', () => {
	it('renders hex values only, for both themes', () => {
		const css = brandVars('#ffd400');
		expect(css).toMatch(/^(--brand-[a-z-]+-(l|d):#[0-9a-f]{6};?)+$/);
		expect(css).toContain('--brand-accent-l:');
		expect(css).toContain('--brand-on-accent-d:');
	});
	it('cannot be used to inject CSS', () => {
		expect(brandVars('#fff;}body{display:none')).toBe(brandVars(null));
	});
});

describe('accentReport', () => {
	it('flags an adjusted colour', () => {
		expect(accentReport('#ffd400').adjusted).toBe(true);
		expect(accentReport('#0e7c7b').adjusted).toBe(false);
	});
});

describe('support email', () => {
	it('accepts plain addresses only', () => {
		expect(isPlainEmail('help+pay@nomin.mn')).toBe(true);
		for (const bad of ['help@nomin.mn?subject=x', 'help@nomin.mn&cc=a@b.mn', 'help me@nomin.mn', 'a%40b@nomin.mn', 'help@nomin', 'a@b@c.mn', '<a@b.mn>']) {
			expect(isPlainEmail(bad), bad).toBe(false);
		}
	});
	it('builds mailto only for a plain address', () => {
		expect(mailtoHref('help@nomin.mn')).toBe('mailto:help@nomin.mn');
		expect(mailtoHref('help+pay@nomin.mn')).toBe('mailto:help%2Bpay@nomin.mn');
		expect(mailtoHref('help@nomin.mn?body=hi')).toBeNull();
		expect(mailtoHref(null)).toBeNull();
	});
});
