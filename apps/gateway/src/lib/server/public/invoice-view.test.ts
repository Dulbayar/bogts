import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../ids';
import { invoice } from '../schema';
import { createTestDb, seedProject, type TestDb } from '../testdb';
import { publicInvoice, qrPath, safeReturnUrl } from './invoice-view';

const NOW = Date.UTC(2026, 8, 25, 6, 0, 0);
let db: TestDb;

beforeEach(() => {
	db = createTestDb();
});

async function seed(over: Partial<typeof invoice.$inferInsert> = {}) {
	const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
	const id = newId();
	await db.insert(invoice).values({
		id,
		projectId: p.id,
		provider: 'qpay',
		amount: 49_000,
		reference: 'secret-order-ref',
		description: 'Pro plan',
		qrText: '0002010102121531279404962794049600022310027138',
		deeplinks: [
			{ name: 'khanbank', description: 'Khan bank', link: 'khanbank://q?qPay_QRcode=x' },
			{ name: 'evil', link: 'javascript:alert(1)' }
		],
		returnUrl: 'https://nomad.example.com/billing/done',
		metadata: { internal: 'yes' },
		expiresAt: NOW + 600_000,
		createdAt: NOW,
		updatedAt: NOW,
		...over
	});
	return id;
}

describe('publicInvoice', () => {
	it('exposes only what the payer needs', async () => {
		const id = await seed();
		const v = await publicInvoice(db, id, NOW);
		expect(v).toMatchObject({ amount: 49_000, description: 'Pro plan', status: 'pending', projectName: 'Nomad Coffee' });
		expect(v!.deeplinks).toEqual([{ name: 'Khan bank', link: 'khanbank://q?qPay_QRcode=x' }]);
		expect(v!.qr!.path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
		const json = JSON.stringify(v);
		expect(json).not.toContain('secret-order-ref');
		expect(json).not.toContain('internal');
	});

	it('reports a pending invoice past expiry as expired, without QR', async () => {
		const id = await seed();
		const v = await publicInvoice(db, id, NOW + 700_000);
		expect(v!.status).toBe('expired');
		expect(v!.qr).toBeNull();
		expect(v!.deeplinks).toEqual([]);
	});

	it('refuses bad ids and unsafe return URLs', async () => {
		expect(await publicInvoice(db, '../etc', NOW)).toBeNull();
		expect(await publicInvoice(db, newId(), NOW)).toBeNull();
		expect(safeReturnUrl('javascript:alert(1)')).toBeNull();
		expect(safeReturnUrl('https://a.mn/x')).toBe('https://a.mn/x');
	});

	it('encodes a QR', () => {
		const { size, path } = qrPath('hello');
		expect(size).toBeGreaterThanOrEqual(21);
		expect(path.length).toBeGreaterThan(10);
	});
});
