/**
 * What the public `/pay/[id]` and `/return/[id]` pages may know about an
 * invoice: amount, description, status, QR, bank links and the return URL
 * (plus the project's name, since the payer is paying that company). Nothing
 * else leaves the database: no reference, metadata or provider ids.
 */
import { eq } from 'drizzle-orm';
import qrcode from 'qrcode-generator';
import type { DB } from '../db';
import { BRANDING_ID, brandView, logoUrl, type BrandView } from '../branding';
import { branding, invoice, project, type Deeplink } from '../schema';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type PublicInvoice = {
	id: string;
	provider: 'qpay' | 'bonum';
	projectName: string;
	/** The project's own public brand (Settings → project → Public page), when set */
	projectDisplayName: string | null;
	projectLogoUrl: string | null;
	/** The company branding, read in the same query */
	brand: BrandView;
	amount: number;
	description: string;
	/** `pending | paid | expired | failed | cancelled`, with a pending invoice past its expiry reported as expired */
	status: string;
	expiresAt: number;
	paidAt: number | null;
	returnUrl: string | null;
	qr: { image: string | null; path: string | null; size: number } | null;
	deeplinks: PublicDeeplink[];
};

/** QPay's `name` (English, e.g. "Khan bank") and `description` (often Mongolian); the page labels it (`$lib/banks`). */
export type PublicDeeplink = { name: string; description?: string; link: string; logo?: string };

/**
 * Where QPay serves bank logos (seen in stored deeplinks). The page's CSP
 * `img-src` allows exactly these (vite.config.ts); any other logo is dropped
 * and the page shows the bank's initial instead.
 */
export const QPAY_LOGO_HOSTS = ['qpay.mn', 's3.qpay.mn'] as const;

function safeLogo(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && !url.port && (QPAY_LOGO_HOSTS as readonly string[]).includes(url.hostname) ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** An http(s) URL, or null. The only redirect target the pages ever use comes from here. */
export function safeReturnUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
	} catch {
		return null;
	}
}

/** A bank-app link is only ever an app scheme or https; never `javascript:` or `data:`. */
function safeDeeplink(d: Deeplink): PublicDeeplink | null {
	try {
		const url = new URL(d.link);
		if (['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'].includes(url.protocol)) return null;
		const logo = safeLogo(d.logo);
		const description = d.description?.trim();
		return { name: d.name.trim() || description || '', ...(description ? { description } : {}), link: d.link, ...(logo ? { logo } : {}) };
	} catch {
		return null;
	}
}

/** An SVG path (`M…h1v1h-1z` per dark module) for `text`, plus the module count. */
export function qrPath(text: string): { path: string; size: number } {
	const qr = qrcode(0, 'M');
	qr.addData(text);
	qr.make();
	const n = qr.getModuleCount();
	let path = '';
	for (let r = 0; r < n; r++) {
		for (let c = 0; c < n; c++) {
			if (!qr.isDark(r, c)) continue;
			// Merge horizontal runs into one rectangle.
			let run = 1;
			while (c + run < n && qr.isDark(r, c + run)) run++;
			path += `M${c} ${r}h${run}v1h-${run}z`;
			c += run - 1;
		}
	}
	return { path, size: n };
}

const BASE64_PNG = /^[A-Za-z0-9+/=\s]+$/;

export async function publicInvoice(db: DB, id: string, now = Date.now()): Promise<PublicInvoice | null> {
	if (!ULID.test(id)) return null;
	const [row] = await db
		.select({ invoice, projectName: project.name, projectDisplayName: project.displayName, projectLogoHash: project.logoHash, branding })
		.from(invoice)
		.innerJoin(project, eq(project.id, invoice.projectId))
		.leftJoin(branding, eq(branding.id, BRANDING_ID))
		.where(eq(invoice.id, id))
		.limit(1);
	if (!row) return null;
	const inv = row.invoice;
	const status = inv.status === 'pending' && inv.expiresAt <= now ? 'expired' : inv.status;
	let qr: PublicInvoice['qr'] = null;
	if (status === 'pending') {
		if (inv.qrImage && BASE64_PNG.test(inv.qrImage)) qr = { image: inv.qrImage.replace(/\s/g, ''), path: null, size: 0 };
		else if (inv.qrText) qr = { image: null, ...qrPath(inv.qrText) };
	}
	return {
		id: inv.id,
		provider: inv.provider,
		projectName: row.projectName,
		projectDisplayName: row.projectDisplayName?.trim() || null,
		projectLogoUrl: logoUrl(row.projectLogoHash),
		brand: brandView(row.branding),
		amount: inv.amount,
		description: inv.description,
		status,
		expiresAt: inv.expiresAt,
		paidAt: inv.paidAt,
		returnUrl: safeReturnUrl(inv.returnUrl),
		qr,
		deeplinks: status === 'pending' ? (inv.deeplinks ?? []).map(safeDeeplink).filter((d) => d !== null) : []
	};
}

/**
 * `/pay/:id/status` requests per client (IPv4 address or IPv6 /64) per minute.
 * Mobile carriers put many payers behind one address (CGNAT), so this is
 * generous; QPay itself is asked at most once per 10 s per invoice regardless.
 */
export const STATUS_LIMIT = 240;
