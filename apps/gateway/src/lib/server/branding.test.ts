import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ApiError } from './api/errors';
import {
	brandingStatement,
	clearBrandingCache,
	dropLogoIfUnused,
	EMPTY_BRAND,
	getBranding,
	getBrandingCached,
	parseBrandInput,
	prepareLogo,
	readLogo,
	sanitizeSvg,
	saveBranding,
	saveProjectBrand,
	sniffLogo,
	storeLogo
} from './branding';
import { brandLogo, project } from './schema';
import { countQueries, createTestDb, seedProject, type TestDb } from './testdb';
import { newId } from './ids';
import { invoice } from './schema';
import { publicInvoice } from './public/invoice-view';
import { payeeOf } from './public/payee';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
const file = (bytes: Uint8Array<ArrayBuffer> | string, name = 'logo', type = 'application/octet-stream') => new File([bytes], name, { type });

let db: TestDb;
beforeEach(() => {
	db = createTestDb();
});

describe('sniffLogo', () => {
	it('reads the real type from the bytes', () => {
		expect(sniffLogo(PNG)).toBe('image/png');
		expect(sniffLogo(WEBP)).toBe('image/webp');
		expect(sniffLogo(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
		expect(sniffLogo(new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'))).toBe('image/svg+xml');
	});
	it('refuses anything else', () => {
		expect(sniffLogo(new TextEncoder().encode('<html><svg></svg></html>'))).toBeNull();
		expect(sniffLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull(); // JPEG
		expect(sniffLogo(new TextEncoder().encode('GIF89a'))).toBeNull();
	});
});

describe('sanitizeSvg', () => {
	it('strips scripts, handlers, foreign content and outside references', () => {
		const dirty = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)" viewBox="0 0 10 10">
	<script>alert(1)</script><script href="https://evil.example/x.js"/>
	<style>@import url(https://evil.example/x.css);</style>
	<foreignObject><iframe src="https://evil.example"></iframe></foreignObject>
	<a href="javascript:alert(1)"><rect width="10" height="10" ONCLICK='x()' fill="url(https://evil.example/p.svg#p)"/></a>
	<use xlink:href="https://evil.example/s.svg#a"/><use href="#local"/>
	<image href="data:image/png;base64,AAAA"/>
	<animate attributeName="href" to="javascript:alert(1)"/>
	<circle id="local" r="2" fill="#0e7c7b"/>
</svg>`;
		const clean = sanitizeSvg(dirty);
		expect(clean.startsWith('<svg')).toBe(true);
		expect(clean.endsWith('</svg>')).toBe(true);
		for (const bad of ['<script', 'onload', 'ONCLICK', 'onclick', '<style', 'foreignObject', 'iframe', 'javascript:', 'evil.example', 'ENTITY', 'DOCTYPE', '<animate', 'data:image']) {
			expect(clean, bad).not.toContain(bad);
		}
		expect(clean).toContain('href="#local"');
		expect(clean).toContain('<circle id="local"');
	});
	it('rejects what is not a single svg document', () => {
		expect(() => sanitizeSvg('<div>hi</div>')).toThrow(ApiError);
		expect(() => sanitizeSvg('<svg><script>')).toThrow(ApiError);
	});
});

describe('prepareLogo', () => {
	it('accepts PNG, WebP and SVG by content, whatever the claimed type', async () => {
		expect((await prepareLogo(file(PNG, 'x.gif', 'image/gif'))).type).toBe('image/png');
		expect((await prepareLogo(file(WEBP))).type).toBe('image/webp');
		const svg = await prepareLogo(file('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><rect/></svg>', 'x.svg', 'image/svg+xml'));
		expect(svg.type).toBe('image/svg+xml');
		expect(new TextDecoder().decode(svg.bytes)).not.toContain('onload');
		expect(svg.hash).toMatch(/^[0-9a-f]{64}$/);
	});
	it('refuses empty, oversized and unknown files', async () => {
		await expect(prepareLogo(file(new Uint8Array()))).rejects.toThrow(/empty/);
		const big = new Uint8Array(256 * 1024 + 1);
		big.set(PNG);
		await expect(prepareLogo(file(big))).rejects.toThrow(/256 KB/);
		await expect(prepareLogo(file('GIF89a......'))).rejects.toThrow(/PNG, SVG or WebP/);
	});
});

describe('parseBrandInput', () => {
	const form = (fields: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(fields)) f.set(k, v);
		return f;
	};
	it('normalises and trims', () => {
		expect(parseBrandInput(form({ companyName: '  Номин ХХК ', accentColor: '0E7C7B', supportEmail: 'help@nomin.mn', supportUrl: 'https://nomin.mn/help' }))).toEqual({
			companyName: 'Номин ХХК',
			accentColor: '#0e7c7b',
			supportEmail: 'help@nomin.mn',
			supportUrl: 'https://nomin.mn/help'
		});
		expect(parseBrandInput(form({}))).toEqual({ companyName: null, accentColor: null, supportEmail: null, supportUrl: null });
	});
	it.each([
		[{ accentColor: 'teal' }, /Accent/],
		[{ supportEmail: 'nope' }, /email/],
		[{ supportUrl: 'http://example.mn' }, /https/],
		[{ supportUrl: 'javascript:alert(1)' }, /https/],
		[{ companyName: 'x'.repeat(81) }, /80/]
	])('refuses %o', (fields, message) => {
		expect(() => parseBrandInput(form(fields as Record<string, string>))).toThrow(message);
	});
});

describe('branding storage', () => {
	it('is the empty brand until saved', async () => {
		expect(await getBranding(db)).toEqual(EMPTY_BRAND);
	});

	it('saves, replaces and removes the logo, dropping unused logo rows', async () => {
		const a = await prepareLogo(file(PNG));
		await storeLogo(db, a);
		await saveBranding(db, { companyName: 'Номин', accentColor: '#ffd400', supportEmail: null, supportUrl: null }, a.hash);
		let b = await getBranding(db);
		expect(b).toMatchObject({ companyName: 'Номин', accent: '#ffd400', logoHash: a.hash, logoUrl: `/brand/logo/${a.hash}` });
		expect(await readLogo(db, a.hash)).toMatchObject({ type: 'image/png' });

		// Keep the logo when none is sent.
		await saveBranding(db, { companyName: 'Номин ХХК', accentColor: null, supportEmail: null, supportUrl: null }, undefined);
		expect((await getBranding(db)).logoHash).toBe(a.hash);

		// Remove it: the row goes too.
		const { previousLogo } = await saveBranding(db, { companyName: null, accentColor: null, supportEmail: null, supportUrl: null }, null);
		await dropLogoIfUnused(db, previousLogo);
		b = await getBranding(db);
		expect(b.logoUrl).toBeNull();
		expect(await readLogo(db, a.hash)).toBeNull();
	});

	it('keeps a logo a project still uses', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const a = await prepareLogo(file(PNG));
		await storeLogo(db, a);
		await saveBranding(db, { companyName: null, accentColor: null, supportEmail: null, supportUrl: null }, a.hash);
		await saveProjectBrand(db, p.id, { displayName: 'Nomad', logo: a.hash });
		await saveBranding(db, { companyName: null, accentColor: null, supportEmail: null, supportUrl: null }, null);
		await dropLogoIfUnused(db, a.hash);
		expect(await db.select().from(brandLogo)).toHaveLength(1);
		const [row] = await db.select().from(project).where(eq(project.id, p.id));
		expect(row).toMatchObject({ displayName: 'Nomad', logoHash: a.hash });
	});

	it('refuses an unknown project', async () => {
		await expect(saveProjectBrand(db, '01J8ZZZZZZZZZZZZZZZZZZZZZZ', { displayName: 'x', logo: undefined })).rejects.toThrow(/not found/i);
	});
});

describe('payeeOf', () => {
	const brand = { ...EMPTY_BRAND, companyName: 'Номин ХХК', logoUrl: '/brand/logo/a', supportEmail: 'help@nomin.mn' };
	it('prefers the project, then the company, then the project name', () => {
		expect(payeeOf({ projectName: 'nomad-prod', projectDisplayName: 'Nomad Coffee', projectLogoUrl: '/brand/logo/b' }, brand)).toMatchObject({
			name: 'Nomad Coffee',
			logoUrl: '/brand/logo/b',
			supportEmail: 'help@nomin.mn'
		});
		expect(payeeOf({ projectName: 'nomad-prod', projectDisplayName: null, projectLogoUrl: null }, brand)).toMatchObject({ name: 'Номин ХХК', logoUrl: '/brand/logo/a' });
		expect(payeeOf({ projectName: 'nomad-prod', projectDisplayName: null, projectLogoUrl: null }, EMPTY_BRAND)).toMatchObject({ name: 'nomad-prod', logoUrl: null });
	});
});

describe('branding round trips', () => {
	it('rides in a batch, is cached per isolate, and joins into the public invoice query', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		await saveBranding(db, { companyName: 'Номин', accentColor: '#015197', supportEmail: 'help@nomin.mn', supportUrl: null }, undefined);
		const stats = countQueries(db);

		stats.reset();
		const [[row]] = await db.batch([brandingStatement(db)]);
		expect(row?.companyName).toBe('Номин');
		expect(stats.roundTrips).toBe(1);

		clearBrandingCache();
		stats.reset();
		await getBrandingCached(db, 1_000);
		await getBrandingCached(db, 30_000);
		expect(stats.roundTrips).toBe(1);
		await getBrandingCached(db, 70_000);
		expect(stats.roundTrips).toBe(2);

		const id = newId();
		await db.insert(invoice).values({ id, projectId: p.id, provider: 'qpay', amount: 1000, reference: 'r', description: 'd', expiresAt: Date.now() + 60_000, createdAt: 1, updatedAt: 1 });
		stats.reset();
		const v = await publicInvoice(db, id);
		expect(stats.roundTrips).toBe(1);
		expect(v!.brand).toMatchObject({ companyName: 'Номин', accent: '#015197', supportEmail: 'help@nomin.mn' });
	});
});
