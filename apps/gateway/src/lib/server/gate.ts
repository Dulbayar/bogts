/** Request classification and response headers, used by `hooks.server.ts`. */

export type Area = 'v1' | 'hooks' | 'admin' | 'health' | 'other';

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The area of a raw `url.pathname`. SvelteKit routes on the decoded path, so
 * classify that (`/%61dmin` is `/admin`); a malformed encoding is 'admin', so
 * it gets the gate rather than slipping past it.
 */
export function areaOf(rawPathname: string): Area {
	let pathname: string;
	try {
		pathname = decodeURIComponent(rawPathname);
	} catch {
		return 'admin';
	}
	if (under(pathname, '/v1')) return 'v1';
	if (under(pathname, '/hooks')) return 'hooks';
	if (under(pathname, '/admin')) return 'admin';
	if (under(pathname, '/health')) return 'health';
	return 'other';
}

export const ADMIN_LOGIN_PATH = '/admin/login';
export const isLoginPath = (pathname: string) => pathname === ADMIN_LOGIN_PATH || pathname === `${ADMIN_LOGIN_PATH}/`;

/** Headers every response carries; `set` only when the route did not choose its own. */
export function applySecurityHeaders(response: Response, url: URL, area: Area): Response {
	let headers = response.headers;
	try {
		headers.set('x-content-type-options', 'nosniff');
	} catch {
		// Immutable headers (a proxied response): copy into a mutable response.
		response = new Response(response.body, response);
		headers = response.headers;
		headers.set('x-content-type-options', 'nosniff');
	}
	const setDefault = (name: string, value: string) => {
		if (!headers.has(name)) headers.set(name, value);
	};
	setDefault('referrer-policy', 'no-referrer');
	setDefault('x-frame-options', 'DENY');
	setDefault('cross-origin-opener-policy', 'same-origin');
	setDefault('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
	if (url.protocol === 'https:') setDefault('strict-transport-security', 'max-age=31536000; includeSubDomains');
	// Pages get SvelteKit's CSP (vite.config.ts); everything else can load nothing.
	setDefault('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
	if (area === 'admin' || area === 'v1' || area === 'hooks') headers.set('cache-control', 'no-store');
	return response;
}
