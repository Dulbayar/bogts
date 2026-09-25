import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { prepareLogo, storeLogo } from '$lib/server/branding';
import { createTestDb } from '$lib/server/testdb';
import { GET } from './+server';

describe('GET /brand/logo/:hash', () => {
	it('serves a stored logo with a year-long cache, a strong ETag and 304s', async () => {
		const db = createTestDb();
		const svg = await prepareLogo(new File(['<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><rect/></svg>'], 'l.svg'));
		await storeLogo(db, svg);
		const run = (hash: string, headers: Record<string, string> = {}) =>
			(GET as unknown as (e: RequestEvent) => Promise<Response>)({
				params: { hash },
				request: new Request(`https://payments.test/brand/logo/${hash}`, { headers }),
				locals: { db }
			} as unknown as RequestEvent);

		const res = await run(svg.hash);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/svg+xml');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(res.headers.get('etag')).toBe(`"${svg.hash}"`);
		expect(res.headers.get('content-security-policy')).toContain('sandbox');
		expect(await res.text()).not.toContain('onload');

		expect((await run(svg.hash, { 'if-none-match': `"${svg.hash}"` })).status).toBe(304);
		expect((await run('f'.repeat(64))).status).toBe(404);
		expect((await run('../etc/passwd')).status).toBe(404);
	});
});
