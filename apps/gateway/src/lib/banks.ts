/**
 * The bank-app grid on the hosted QPay page: which banks come first, what
 * they are called, and how many show before "More". QPay sends its deeplinks
 * in its own order with loose casing ("Khan bank", "Trade and Development
 * bank"); the page shows the popular apps first under tidy names.
 */

/** Tiles shown before "More"; with the More tile they fill a 3×3 grid. */
export const BANKS_SHOWN = 8;

type Known = {
	/** Normalised QPay names (see `key`) this bank has been sent under */
	names: string[];
	/** The deeplink's URL scheme, when known; steadier than the name */
	scheme?: string;
	/** The name shown; QPay's own, title-cased, when absent */
	label?: string;
};

/** The popular apps, in the order they are shown. */
const POPULAR: Known[] = [
	{ names: ['socialpay'], scheme: 'socialpay-payment' },
	{ names: ['khanbank'], scheme: 'khanbank' },
	{ names: ['mbank'], scheme: 'mbank', label: 'M Bank' },
	{ names: ['tradeanddevelopmentbank', 'tdbonline', 'tdb'], scheme: 'tdbbank', label: 'TDB' },
	{ names: ['xacbank'], scheme: 'xacbank' },
	{ names: ['capitronbank'], scheme: 'capitronbank' },
	{ names: ['monpay'], scheme: 'monpay', label: 'Monpay' },
	{ names: ['statebank30'], label: 'State Bank 3.0' }
];

export type BankLink = { name: string; description?: string; link: string; logo?: string };
export type BankTile = BankLink & { label: string };

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function scheme(link: string): string {
	const i = link.indexOf(':');
	return i > 0 ? link.slice(0, i).toLowerCase() : '';
}

function rank(d: BankLink): number {
	const k = key(d.name);
	const s = scheme(d.link);
	const i = POPULAR.findIndex((b) => b.names.includes(k) || (b.scheme !== undefined && b.scheme === s));
	return i === -1 ? POPULAR.length : i;
}

const SMALL = new Set(['and', 'of', 'the', 'for']);

/**
 * "Khan bank" → "Khan Bank", "trade and development bank" → "Trade and
 * Development Bank". Letters already capitalised stay so ("QPay wallet" →
 * "QPay Wallet"); words that are not Latin are left alone.
 */
export function titleCase(name: string): string {
	return name
		.trim()
		.split(/\s+/)
		.map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : /^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
		.join(' ');
}

/** The deeplinks in display order (popular first, then QPay's order), each with its label. */
export function bankTiles(links: BankLink[]): BankTile[] {
	return links
		.map((d, i) => ({ d, i, r: rank(d) }))
		.sort((a, b) => a.r - b.r || a.i - b.i)
		.map(({ d, r }) => ({ ...d, label: POPULAR[r]?.label ?? titleCase(d.name) }));
}
