/**
 * Company branding (Settings → Branding) and per-project overrides for the
 * public pay pages. Logos are content-addressed rows in `brand_logo`, served
 * by `/brand/logo/<hash>` with a year-long cache.
 */
import { eq } from 'drizzle-orm';
import { ApiError } from './api/errors';
import type { DB } from './db';
import { normalizeHex } from '../brand';
import { brandLogo, branding, project, type LogoType } from './schema';

export const BRANDING_ID = 'default';
export const LOGO_MAX_BYTES = 256 * 1024;
const HASH = /^[0-9a-f]{64}$/;

export type BrandView = {
	companyName: string | null;
	/** `/brand/logo/<hash>`, or null for the Bogts mark */
	logoUrl: string | null;
	logoHash: string | null;
	accent: string | null;
	supportEmail: string | null;
	supportUrl: string | null;
};

export const EMPTY_BRAND: BrandView = {
	companyName: null,
	logoUrl: null,
	logoHash: null,
	accent: null,
	supportEmail: null,
	supportUrl: null
};

export const logoUrl = (hash: string | null | undefined) => (hash && HASH.test(hash) ? `/brand/logo/${hash}` : null);
export const isLogoHash = (hash: string) => HASH.test(hash);

/** The company branding; the empty brand when none is saved (or the table is missing on an old database). */
export async function getBranding(db: DB): Promise<BrandView> {
	try {
		const [row] = await db.select().from(branding).where(eq(branding.id, BRANDING_ID)).limit(1);
		if (!row) return EMPTY_BRAND;
		return {
			companyName: row.companyName,
			logoUrl: logoUrl(row.logoHash),
			logoHash: row.logoHash,
			accent: normalizeHex(row.accentColor),
			supportEmail: row.supportEmail,
			supportUrl: row.supportUrl
		};
	} catch (err) {
		console.error('[branding] read failed', err instanceof Error ? err.name : typeof err);
		return EMPTY_BRAND;
	}
}

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export type BrandInput = {
	companyName: string | null;
	accentColor: string | null;
	supportEmail: string | null;
	supportUrl: string | null;
};

/** The text fields of the Branding form, validated. Throws a 400 ApiError naming the field. */
export function parseBrandInput(form: FormData): BrandInput {
	const text = (name: string) => String(form.get(name) ?? '').trim() || null;
	const companyName = text('companyName');
	if (companyName && companyName.length > 80) throw new ApiError(400, 'invalid_request', 'Company name: 80 characters at most');

	const rawAccent = text('accentColor');
	const accentColor = rawAccent ? normalizeHex(rawAccent) : null;
	if (rawAccent && !accentColor) throw new ApiError(400, 'invalid_request', 'Accent colour: use a hex colour such as #0e7c7b');

	const supportEmail = text('supportEmail');
	if (supportEmail && (supportEmail.length > 254 || !EMAIL.test(supportEmail)))
		throw new ApiError(400, 'invalid_request', 'Support email: enter an address such as help@example.mn');

	const supportUrl = text('supportUrl');
	if (supportUrl) {
		let ok = false;
		try {
			ok = supportUrl.length <= 2048 && new URL(supportUrl).protocol === 'https:';
		} catch {
			ok = false;
		}
		if (!ok) throw new ApiError(400, 'invalid_request', 'Support URL: use an https:// address');
	}
	return { companyName, accentColor, supportEmail, supportUrl };
}

/* ------------------------------------------------------------------ *
 * Logos
 * ------------------------------------------------------------------ */

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The logo type from the bytes themselves (never the upload's claimed type). */
export function sniffLogo(bytes: Uint8Array): LogoType | null {
	if (bytes.length >= 8 && PNG.every((b, i) => bytes[i] === b)) return 'image/png';
	const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
	if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 1024)).replace(/^﻿/, '').trimStart();
	if (/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
	return null;
}

/**
 * An SVG with everything active removed: scripts, `<foreignObject>`, event
 * handler attributes, `javascript:`/external references, DOCTYPE/ENTITY
 * declarations, and `<style>` (which could `@import`). The route also serves
 * SVG with `Content-Security-Policy: sandbox` and browsers never run scripts in
 * an `<img>`, so this is the second of three layers. Throws when what is left
 * is not a single `<svg>` document.
 */
export function sanitizeSvg(input: string): string {
	let s = input.replace(/^﻿/, '');
	s = s.replace(/<\?xml[\s\S]*?\?>/gi, '');
	s = s.replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, '');
	s = s.replace(/<!ENTITY[\s\S]*?>/gi, '');
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
	for (const tag of ['script', 'foreignObject', 'style', 'iframe', 'embed', 'object', 'audio', 'video', 'animate', 'set', 'animateTransform', 'animateMotion', 'handler', 'listener']) {
		s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
		s = s.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
		s = s.replace(new RegExp(`<\\/${tag}\\s*>`, 'gi'), '');
	}
	// Attributes: event handlers, and any href/src that is not an in-document #fragment.
	s = s.replace(/\s(on[a-z0-9_:-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
	s = s.replace(/\s((?:xlink:)?href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (whole, _name: string, value: string) => {
		const v = value.replace(/^["']|["']$/g, '').trim();
		return v.startsWith('#') ? whole : '';
	});
	// `url(...)` in presentation attributes may only point inside the document.
	s = s.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
	s = s.replace(/javascript:/gi, '');
	s = s.trim();
	if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) throw new ApiError(400, 'invalid_request', 'Logo: the SVG could not be read');
	return s;
}

function toBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** An uploaded file, checked and made safe: its type, stored bytes and hash. Throws a 400 ApiError. */
export async function prepareLogo(file: File): Promise<{ type: LogoType; bytes: Uint8Array<ArrayBuffer>; hash: string }> {
	if (file.size === 0) throw new ApiError(400, 'invalid_request', 'Logo: the file is empty');
	if (file.size > LOGO_MAX_BYTES) throw new ApiError(400, 'invalid_request', 'Logo: 256 KB at most');
	let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await file.arrayBuffer());
	const type = sniffLogo(bytes);
	if (!type) throw new ApiError(400, 'invalid_request', 'Logo: use a PNG, SVG or WebP file');
	if (type === 'image/svg+xml') {
		const clean = sanitizeSvg(new TextDecoder().decode(bytes));
		bytes = new TextEncoder().encode(clean);
	}
	return { type, bytes, hash: await sha256Hex(bytes) };
}

/** Stores a prepared logo (a no-op when the same bytes are already stored). */
export async function storeLogo(db: DB, logo: { type: LogoType; bytes: Uint8Array; hash: string }, now = Date.now()): Promise<string> {
	await db
		.insert(brandLogo)
		.values({ hash: logo.hash, contentType: logo.type, data: toBase64(logo.bytes), size: logo.bytes.length, createdAt: now })
		.onConflictDoNothing();
	return logo.hash;
}

export async function readLogo(db: DB, hash: string): Promise<{ type: LogoType; bytes: Uint8Array<ArrayBuffer> } | null> {
	if (!HASH.test(hash)) return null;
	const [row] = await db.select().from(brandLogo).where(eq(brandLogo.hash, hash)).limit(1);
	return row ? { type: row.contentType, bytes: fromBase64(row.data) } : null;
}

/** Deletes a logo nothing points at any more (the company brand or any project). */
export async function dropLogoIfUnused(db: DB, hash: string | null | undefined): Promise<void> {
	if (!hash || (await logoInUse(db, hash))) return;
	await db.delete(brandLogo).where(eq(brandLogo.hash, hash));
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Saves the company branding. `logo`: a new hash, `null` to remove it, or
 * `undefined` to keep the current one. Returns the previous logo hash.
 */
export async function saveBranding(
	db: DB,
	input: BrandInput,
	logo: string | null | undefined,
	now = Date.now()
): Promise<{ previousLogo: string | null }> {
	const [row] = await db.select({ logoHash: branding.logoHash }).from(branding).where(eq(branding.id, BRANDING_ID)).limit(1);
	const previousLogo = row?.logoHash ?? null;
	const logoHash = logo === undefined ? previousLogo : logo;
	const values = { ...input, logoHash, updatedAt: now };
	await db
		.insert(branding)
		.values({ id: BRANDING_ID, ...values })
		.onConflictDoUpdate({ target: branding.id, set: values });
	return { previousLogo };
}

/** A project's public-page override: its display name and logo (`undefined` keeps the logo). */
export async function saveProjectBrand(
	db: DB,
	projectId: string,
	input: { displayName: string | null; logo: string | null | undefined },
	now = Date.now()
): Promise<{ previousLogo: string | null }> {
	const [row] = await db.select({ logoHash: project.logoHash }).from(project).where(eq(project.id, projectId)).limit(1);
	if (!row) throw new ApiError(404, 'not_found', 'Project not found');
	if (input.displayName && input.displayName.length > 80) throw new ApiError(400, 'invalid_request', 'Display name: 80 characters at most');
	const set: { displayName: string | null; updatedAt: number; logoHash?: string | null } = { displayName: input.displayName, updatedAt: now };
	if (input.logo !== undefined) set.logoHash = input.logo;
	await db.update(project).set(set).where(eq(project.id, projectId));
	return { previousLogo: row.logoHash };
}

/** Whether the company brand or any project still points at a logo. */
export async function logoInUse(db: DB, hash: string): Promise<boolean> {
	const [p] = await db.select({ id: project.id }).from(project).where(eq(project.logoHash, hash)).limit(1);
	const [b] = await db.select({ id: branding.id }).from(branding).where(eq(branding.logoHash, hash)).limit(1);
	return Boolean(p || b);
}

/** The optional logo file of a form: a File with bytes, or null when none was chosen. */
export function fileFrom(form: FormData, name: string): File | null {
	const v = form.get(name);
	return v instanceof File && v.size > 0 ? v : null;
}
