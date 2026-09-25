/** The Bogts pouch as a favicon data URI (data: is allowed by the CSP's img-src). */
export function faviconSvg(accent: string, sandbox = false): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
		`<rect width="32" height="32" rx="8" fill="${accent}"/>` +
		`<g transform="translate(3.2 2.6) scale(.8)" fill="#fff">` +
		`<path opacity=".75" d="M11.6 12.6 9.7 7.3c-.3-.9.6-1.6 1.4-1.2l2.3 1.1L16 5l2.6 2.2 2.3-1.1c.8-.4 1.7.3 1.4 1.2l-1.9 5.3z"/>` +
		`<path d="M11 12.4c-4.5 2.9-6 7.4-5.4 11 .7 4.2 4.8 5.9 10.4 5.9s9.7-1.7 10.4-5.9c.6-3.6-.9-8.1-5.4-11z"/>` +
		`<rect x="9.6" y="10.9" width="12.8" height="3.1" rx="1.55" fill="#d4a54a"/>` +
		`<circle cx="16" cy="21.6" r="4.3" fill="#d4a54a"/><rect x="14.55" y="20.15" width="2.9" height="2.9" rx=".4"/></g>` +
		(sandbox ? `<circle cx="25" cy="7" r="6" fill="#f5a524" stroke="#fff" stroke-width="2"/>` : '') +
		`</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
