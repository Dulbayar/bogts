import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// static/_headers caches /fonts/* for a year as immutable, so a font's URL must change with its bytes.
const root = fileURLToPath(new URL('../../', import.meta.url));

describe('self-hosted fonts', () => {
	it('are named by the hash of their bytes, and app.css points at them', () => {
		const css = readFileSync(`${root}src/app.css`, 'utf8');
		const urls = [...css.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]!);
		const files = readdirSync(`${root}static/fonts`).filter((f) => f.endsWith('.woff2'));
		expect(urls.sort()).toEqual(files.sort());
		for (const file of files) {
			const hash = createHash('sha256').update(readFileSync(`${root}static/fonts/${file}`)).digest('hex').slice(0, 8);
			expect(file, file).toMatch(new RegExp(`\\.${hash}\\.woff2$`));
		}
	});
});
