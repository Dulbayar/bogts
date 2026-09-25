import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoice, type Invoice } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createTestDb, seedProject, testConfig } from '../../testdb';
import { resetBonumTokenCache } from './client';
import { bonumInvoiceAdapter } from './invoice';
import { fakeBonum, jsonResponse } from './testing';

const CREATE = 'POST /bonum-gateway/ecommerce/invoices';
let ctx: ServiceContext;
let inv: Invoice;

beforeEach(async () => {
	const db = createTestDb();
	ctx = { db, config: testConfig(), now: 1_000_000 };
	const projectId = (await seedProject(db)).project.id;
	[inv] = await db
		.insert(invoice)
		.values({
			id: '01JINVOICE0000000000000000',
			projectId,
			provider: 'bonum',
			amount: 10_000,
			reference: 'order-1',
			description: 'Coffee beans',
			expiresAt: 1_000_000 + 1_800_000,
			createdAt: 1_000_000,
			updatedAt: 1_000_000
		})
		.returning() as [Invoice];
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('bonumInvoiceAdapter', () => {
	it('creates an All-in-one invoice keyed by our id', async () => {
		const bonum = fakeBonum({
			[CREATE]: () =>
				jsonResponse({
					invoiceId: '8cf2c49d200f049f2b384f0adf42b981c141b6f269a137ea9616ea93e80c9d4d',
					followUpLink: 'https://ecommerce.bonum.mn/ecommerce?invoiceId=c511ea63fbc08e8ea2ca6879b07bf764'
				})
		});
		const r = await bonumInvoiceAdapter.create(ctx, inv);
		expect(r).toEqual({
			providerInvoiceId: '8cf2c49d200f049f2b384f0adf42b981c141b6f269a137ea9616ea93e80c9d4d',
			redirectUrl: 'https://ecommerce.bonum.mn/ecommerce?invoiceId=c511ea63fbc08e8ea2ca6879b07bf764'
		});
		const [call] = bonum.to(CREATE);
		expect(call!.body).toEqual({
			amount: 10_000,
			callback: 'https://payments.test/return/01JINVOICE0000000000000000',
			transactionId: '01JINVOICE0000000000000000',
			expiresIn: 1800,
			// Bonum's sandbox refuses an item without `remark`.
			items: [{ title: 'Coffee beans', remark: '', amount: 10_000, count: 1 }]
		});
		expect(call!.headers.get('accept-language')).toBe('mn');
		expect(bonumInvoiceAdapter.check).toBeUndefined();
	});

	it('refuses a follow-up link off bonum.mn', async () => {
		fakeBonum({ [CREATE]: () => jsonResponse({ invoiceId: 'x', followUpLink: 'https://evil.example/pay' }) });
		await expect(bonumInvoiceAdapter.create(ctx, inv)).rejects.toMatchObject({ code: 'untrusted_host' });
	});
});
