import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoice, type Invoice } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createTestDb, seedProject, testConfig } from '../../testdb';
import { resetBonumTokenCache } from './client';
import { bonumInvoiceAdapter } from './invoice';
import { fakeBonum, jsonResponse } from './testing';

const CREATE = 'POST /bonum-gateway/ecommerce/invoices';
const QR_CREATE = 'POST /mpay-service/merchant/transaction/qr/create';
const QR_LOOKUP = 'POST /mpay-service/merchant/transaction/qr';

/** The QR text the sandbox answers with (2026-09-30): QPay's EMV format, 241 characters. */
const QR_TEXT =
	'000201010212153127940496279404960026091000000100000110000000000000045204599953034965402100' +
	'5802MN5913NEO APP TEST6011ULAANBAATAR622401200000000000000000000063047A1B'.padEnd(151, '0');

/** `qr/create`, shaped as the sandbox answered it; the links trimmed to what the tests need. */
const qrCreated = (over: Record<string, unknown> = {}) =>
	jsonResponse({
		traceId: '6abc6b122a2ea5e035f99ff5760265b9',
		status: 200,
		data: {
			invoiceId: 'cd33649a4f336d07610bbee606a5acd3',
			qrCode: QR_TEXT,
			qrImage: 'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AAAAAklEQVR4AewaftIAAA==',
			links: [
				{
					name: 'Khan bank',
					description: 'Хаан банк',
					logo: 'https://qpay.mn/q/logo/khanbank.png',
					link: `khanbank://q?qPay_QRcode=${QR_TEXT}`,
					appStoreId: '1555908766',
					androidPackageName: 'com.khanbank.retail'
				},
				{ name: 'Evil', link: 'javascript:alert(1)' },
				{ name: 'Plain logo', logo: 'http://example.test/x.png', link: `tdbbank://q?qPay_QRcode=${QR_TEXT}` }
			],
			...over
		}
	});

/** The QR invoice lookup (`transaction/qr`), as the sandbox answered it for an unpaid QR. */
const qrLookup = (status: string, amount: unknown = 10_000.0) =>
	jsonResponse({
		status: 200,
		data: {
			merchant: { name: 'Neo App', id: 11, merchantId: '000000000000034' },
			invoice: { invoiceId: 5336, currency: 'MNT', amount, createdAt: '2026-09-30 09:51:15', status, initType: 'ECOMMERCE', terminalId: '17171119' }
		}
	});
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
	});

	it('never asks Bonum about a hosted checkout: its status endpoint is test-only', async () => {
		const bonum = fakeBonum();
		const stored = { ...inv, providerInvoiceId: '8cf2c49d', method: 'checkout' as const };
		expect(await bonumInvoiceAdapter.check!(ctx, stored)).toEqual({ paid: false });
		expect(bonum.calls).toHaveLength(0);
	});

	it('creates a QR invoice with qr/create, and hands back the QR and bank links checked', async () => {
		const bonum = fakeBonum({ [QR_CREATE]: () => qrCreated() });
		const r = await bonumInvoiceAdapter.create(ctx, { ...inv, method: 'qr' });
		expect(r).toEqual({
			providerInvoiceId: 'cd33649a4f336d07610bbee606a5acd3',
			qrText: QR_TEXT,
			qrImage: 'iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AAAAAklEQVR4AewaftIAAA==',
			deeplinks: [
				{ name: 'Khan bank', description: 'Хаан банк', logo: 'https://qpay.mn/q/logo/khanbank.png', link: `khanbank://q?qPay_QRcode=${QR_TEXT}` },
				// A script link is dropped; a logo that isn't https is dropped from its link.
				{ name: 'Plain logo', link: `tdbbank://q?qPay_QRcode=${QR_TEXT}` }
			]
		});
		const [call] = bonum.to(QR_CREATE);
		expect(call!.body).toEqual({ amount: 10_000, transactionId: '01JINVOICE0000000000000000', expiresIn: 1800 });
		expect(bonum.count(CREATE)).toBe(0);
	});

	it('refuses a QR answer with nothing to show the payer', async () => {
		fakeBonum({ [QR_CREATE]: () => qrCreated({ qrCode: '' }) });
		await expect(bonumInvoiceAdapter.create(ctx, { ...inv, method: 'qr' })).rejects.toMatchObject({ code: 'invalid_response' });
	});

	it('checks a QR invoice by its QR code, and reports it unpaid while it is open', async () => {
		const bonum = fakeBonum({ [QR_LOOKUP]: () => qrLookup('OPEN') });
		const stored = { ...inv, method: 'qr' as const, qrText: QR_TEXT, providerInvoiceId: 'cd33649a4f336d07610bbee606a5acd3' };
		expect(await bonumInvoiceAdapter.check!(ctx, stored)).toEqual({ paid: false });
		expect(bonum.to(QR_LOOKUP)[0]!.body).toEqual({ qrCode: QR_TEXT });
	});

	it("reports a paid QR invoice under the id qr/create gave, not the lookup's own", async () => {
		fakeBonum({ [QR_LOOKUP]: () => qrLookup('PAID', '10000.00') });
		const stored = { ...inv, method: 'qr' as const, qrText: QR_TEXT, providerInvoiceId: 'cd33649a4f336d07610bbee606a5acd3' };
		// The same reference a late PAYMENT webhook would settle under, so the ledger holds one payment.
		expect(await bonumInvoiceAdapter.check!(ctx, stored)).toEqual({
			paid: true,
			providerRef: 'cd33649a4f336d07610bbee606a5acd3',
			amount: 10_000,
			paidAt: 1_000_000
		});
	});

	it('refuses a paid QR invoice whose amount is not whole tugriks', async () => {
		fakeBonum({ [QR_LOOKUP]: () => qrLookup('PAID', 10_000.5) });
		const stored = { ...inv, method: 'qr' as const, qrText: QR_TEXT, providerInvoiceId: 'cd33649a4f336d07610bbee606a5acd3' };
		await expect(bonumInvoiceAdapter.check!(ctx, stored)).rejects.toMatchObject({ code: 'invalid_amount' });
	});

	it('refuses a follow-up link off bonum.mn', async () => {
		fakeBonum({ [CREATE]: () => jsonResponse({ invoiceId: 'x', followUpLink: 'https://evil.example/pay' }) });
		await expect(bonumInvoiceAdapter.create(ctx, inv)).rejects.toMatchObject({ code: 'untrusted_host' });
	});
});
