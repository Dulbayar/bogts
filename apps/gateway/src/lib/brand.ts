/**
 * Brand colour: one accent picked in Settings becomes a set of CSS variables
 * for the light and the dark theme, each checked against WCAG 2.2 AA:
 *
 *  - `accent`: fills (primary button, chart bars, active marks), at least 3:1
 *    against the card background (non-text contrast, SC 1.4.11);
 *  - `on-accent`: text on that fill, white or ink, whichever reads better
 *    (always at least 4.5:1);
 *  - `accent-text`: links and accent-coloured text, at least 4.5:1 against
 *    every background it sits on (SC 1.4.3).
 *
 * Pure functions: used by the server (to render the variables) and by the
 * Settings preview in the browser.
 */

/** Bogts' own accent: the blue of the pouch in the logo. */
export const DEFAULT_ACCENT = '#0d47d2';

/** The surfaces the accent must read on (keep in sync with app.css). */
export const SURFACES = {
	light: { card: '#ffffff', page: '#f4f5f3', ink: '#14191a' },
	dark: { card: '#161b1c', page: '#0f1314', ink: '#0b0f10', raised: '#1d2324' }
} as const;

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` (lower case) for a hex colour in `#rgb` or `#rrggbb` form, or null. */
export function normalizeHex(input: string | null | undefined): string | null {
	if (!input) return null;
	let s = input.trim().toLowerCase();
	if (!s.startsWith('#')) s = `#${s}`;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
	if (short) s = `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
	return HEX.test(s) ? s : null;
}

/**
 * A plain email address: no `?`, `&`, `%`, spaces or anything else that
 * would add headers or a body to a `mailto:` link.
 */
const PLAIN_EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export const isPlainEmail = (email: string): boolean => email.length <= 254 && PLAIN_EMAIL.test(email);

/** `mailto:` for a plain address (percent-encoded all the same), or null for anything else. */
export function mailtoHref(email: string | null | undefined): string | null {
	return email && isPlainEmail(email) ? `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}` : null;
}

type RGB = [number, number, number];

function rgb(hex: string): RGB {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: RGB): string {
	return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
	const [r, g, b] = rgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as RGB;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** Mix `a` into `b`: `amount` 0 is `b`, 1 is `a`. */
export function mix(a: string, b: string, amount: number): string {
	const ca = rgb(a);
	const cb = rgb(b);
	return toHex([0, 1, 2].map((i) => ca[i]! * amount + cb[i]! * (1 - amount)) as RGB);
}

/* HSL, for moving lightness while keeping the hue. */
function toHsl(hex: string): [number, number, number] {
	const [r, g, b] = rgb(hex).map((v) => v / 255) as RGB;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
	if (s === 0) return toHex([l * 255, l * 255, l * 255]);
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const f = (t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	return toHex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}

/**
 * `color`, darkened (on a light background) or lightened (on a dark one) in
 * small lightness steps until it reaches `ratio` against every background.
 * Keeps the hue, so a brand colour stays recognisable.
 */
export function ensureContrast(color: string, backgrounds: string | string[], ratio: number): string {
	const bgs = Array.isArray(backgrounds) ? backgrounds : [backgrounds];
	const ok = (c: string) => bgs.every((bg) => contrast(c, bg) >= ratio);
	if (ok(color)) return color;
	const darkBg = luminance(bgs[0]!) < 0.2;
	const [h, s, l0] = toHsl(color);
	for (let i = 1; i <= 100; i++) {
		const l = darkBg ? Math.min(1, l0 + i * 0.01) : Math.max(0, l0 - i * 0.01);
		const c = fromHsl(h, s, l);
		if (ok(c)) return c;
	}
	return darkBg ? '#ffffff' : '#000000';
}

/** White or ink text on a fill, whichever contrasts more. */
export function onColor(fill: string, ink: string = SURFACES.light.ink): string {
	return contrast(fill, '#ffffff') >= contrast(fill, ink) ? '#ffffff' : ink;
}

export type AccentSet = {
	accent: string;
	accentHover: string;
	onAccent: string;
	accentText: string;
	accentSubtle: string;
	accentBorder: string;
};

export type Palette = { light: AccentSet; dark: AccentSet };

/** The light and dark accent sets for a brand colour (the default when it is missing or invalid). */
export function palette(input: string | null | undefined): Palette {
	const base = normalizeHex(input) ?? DEFAULT_ACCENT;
	const L = SURFACES.light;
	const D = SURFACES.dark;

	// The fill: 3:1 against the card, then nudged away from its label colour
	// when neither white nor ink quite reaches 4.5:1 (mid greys).
	const settle = (fill: string, ink: string) => {
		const on = onColor(fill, ink);
		return ensureContrast(fill, on, 4.5);
	};
	const lAccent = settle(ensureContrast(base, L.card, 3), L.ink);
	const lText = ensureContrast(base, [L.card, L.page, mix(lAccent, L.card, 0.1)], 4.5);
	const dAccent = settle(ensureContrast(base, D.card, 3), D.ink);
	const dText = ensureContrast(base, [D.card, D.page, D.raised, mix(dAccent, D.card, 0.16)], 4.5);

	// Hover moves away from the text colour, so the label only gets easier to read.
	const hover = (fill: string, text: string) => {
		const [h, s, l] = toHsl(fill);
		return fromHsl(h, s, text === '#ffffff' ? Math.max(0, l - 0.06) : Math.min(1, l + 0.06));
	};
	const lOn = onColor(lAccent);
	const dOn = onColor(dAccent, D.ink);

	return {
		light: {
			accent: lAccent,
			accentHover: hover(lAccent, lOn),
			onAccent: lOn,
			accentText: lText,
			accentSubtle: mix(lAccent, L.card, 0.1),
			accentBorder: mix(lAccent, L.card, 0.32)
		},
		dark: {
			accent: dAccent,
			accentHover: hover(dAccent, dOn),
			onAccent: dOn,
			accentText: dText,
			accentSubtle: mix(dAccent, D.card, 0.16),
			accentBorder: mix(dAccent, D.card, 0.42)
		}
	};
}

const VAR: Record<keyof AccentSet, string> = {
	accent: 'accent',
	accentHover: 'accent-hover',
	onAccent: 'on-accent',
	accentText: 'accent-text',
	accentSubtle: 'accent-subtle',
	accentBorder: 'accent-border'
};

/**
 * `--brand-accent-l:#…;…;--brand-accent-d:#…` for a `style` attribute or a
 * `:root` rule. app.css maps these onto the theme tokens, so the order of
 * stylesheets never matters. Values are validated hex, safe to inline.
 */
export function brandVars(input: string | null | undefined): string {
	const p = palette(input);
	const parts: string[] = [];
	for (const [mode, set] of [
		['l', p.light],
		['d', p.dark]
	] as const) {
		for (const key of Object.keys(VAR) as (keyof AccentSet)[]) parts.push(`--brand-${VAR[key]}-${mode}:${set[key]}`);
	}
	return parts.join(';');
}

/** The AA checks shown next to the colour picker. */
export function accentReport(input: string | null | undefined) {
	const p = palette(input);
	const base = normalizeHex(input) ?? DEFAULT_ACCENT;
	return {
		adjusted: p.light.accent !== base || p.dark.accent !== base,
		light: {
			button: contrast(p.light.accent, p.light.onAccent),
			link: contrast(p.light.accentText, SURFACES.light.card)
		},
		dark: {
			button: contrast(p.dark.accent, p.dark.onAccent),
			link: contrast(p.dark.accentText, SURFACES.dark.card)
		}
	};
}
