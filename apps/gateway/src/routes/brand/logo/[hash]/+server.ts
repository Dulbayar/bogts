/**
 * An uploaded logo. The URL is the sha-256 of the bytes, so the response never
 * changes: cached for a year, with the hash as a strong ETag. SVG is sanitised
 * on upload and served sandboxed, so opening it directly runs nothing.
 */
import { isLogoHash, readLogo } from '$lib/server/branding';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
	const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } });
	if (!isLogoHash(params.hash)) return notFound();
	const etag = `"${params.hash}"`;
	const headers: Record<string, string> = {
		etag,
		'cache-control': 'public, max-age=31536000, immutable',
		'cross-origin-resource-policy': 'same-origin',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
	};
	const match = request.headers.get('if-none-match');
	if (match && match.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });
	const logo = await readLogo(locals.db, params.hash);
	if (!logo) return notFound();
	return new Response(logo.bytes, { headers: { ...headers, 'content-type': logo.type, 'content-length': String(logo.bytes.length) } });
};
