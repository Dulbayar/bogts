/**
 * The Bogts logo (.github/assets/logo.png) as flat SVG: a blue coin pouch
 * tied with an orange cord. Fixed colours: it is our mark, never tinted with
 * a company's accent. One source for `BogtsMark.svelte` and the favicon.
 */
export const MARK_VIEWBOX = '0 0 512 512';
export const MARK_SVG =
	`<path fill="#0735a4" d="M150 185C90 220 40 290 40 360c0 80 80 125 200 125 100 0 190-25 202-80 13-75-42-165-102-220z"/>` +
	`<path fill="#0d47d2" d="M190 192c-70 45-100 108-96 148 6 60 96 100 206 120 70 12 125-10 140-60 10-70-40-150-100-210z"/>` +
	`<path fill="#0735a4" d="M150 182c-20-32-54-62-54-86 0-26 34-36 69-30 20-24 50-38 75-38 30 0 50 16 65 36 35-14 90-4 93 22 2 24-28 55-53 96z"/>` +
	`<path fill="#0d47d2" d="M212 184c-15-42-30-86-44-118 22-26 48-38 72-38 30 0 52 18 65 38-14 34-22 76-22 118zM300 184c0-50 10-92 30-124 30-8 66 4 68 28 2 24-28 58-53 96z"/>` +
	`<path fill="none" stroke="#f85a38" stroke-width="34" stroke-linecap="round" d="M160 178q80 20 156 8"/>` +
	`<path fill="none" stroke="#f85a38" stroke-width="22" stroke-linecap="round" d="M318 205c6 30 12 57 12 83M332 200c35 22 60 52 73 82"/>` +
	`<circle cx="316" cy="190" r="30" fill="#e04b2e"/><circle cx="322" cy="186" r="26" fill="#f85a38"/>` +
	`<path fill="#f85a38" d="M312 298h36c4 32 4 72-18 82-25 10-50-8-44-30 4-18 16-32 26-52zM390 300l30-10c20 20 55 45 52 68-2 24-42 34-60 22-12-10-17-40-22-80z"/>` +
	`<rect x="308" y="279" width="44" height="22" rx="11" fill="#eac06c"/>` +
	`<rect x="383" y="273" width="44" height="22" rx="11" fill="#eac06c" transform="rotate(-20 405 284)"/>`;

/** The Bogts logo as a favicon data URI (data: is allowed by the CSP's img-src). */
export function faviconSvg(sandbox = false): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">${MARK_SVG}` +
		(sandbox ? `<circle cx="416" cy="96" r="84" fill="#f5a524" stroke="#fff" stroke-width="24"/>` : '') +
		`</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
