import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { event, invoice, ledger } from '../schema';
import { createTestDb, seedProject, testConfig, type TestDb } from '../testdb';
import { newId } from '../ids';
import type { ServiceContext } from './context';
import { endInvoice, settleInvoice } from './settle';

let db: TestDb;
let ctx: ServiceContext;
let projectId: string;

async function makeInvoice(overrides: Partial<typeof invoice.$inferInsert> = {}) {
	const id = newId();
	await db.insert(invoice).values({
		id,
		projectId,
		provider: 'qpay',
		amount: 49_900,
		reference: 'order-1',
		description: 'Test',
		expiresAt: 2_000,
		createdAt: 1_000,
		updatedAt: 1_000,
		...overrides
	});
	const [row] = await db.select().from(invoice).where(eq(invoice.id, id));
	if (!row) throw new Error('invoice not inserted');
	return row;
}

beforeEach(async () => {
	db = createTestDb();
	projectId = (await seedProject(db)).project.id;
	ctx = { db, config: testConfig(), now: 5_000 };
});

describe('settleInvoice', () => {
	it('pays once, writes one ledger row and one event', async () => {
		const inv = await makeInvoice();
		expect(await settleInvoice(ctx, inv, { providerRef: 'pay-1', amount: 49_900 })).toBe('settled');
		expect(await settleInvoice(ctx, inv, { providerRef: 'pay-1', amount: 49_900 })).toBe('duplicate');
		const [row] = await db.select().from(invoice).where(eq(invoice.id, inv.id));
		expect(row).toMatchObject({ status: 'paid', paidAt: 5_000, providerTransactionId: 'pay-1' });
		expect(await db.select().from(ledger)).toHaveLength(1);
		const events = await db.select().from(event);
		expect(events.map((e) => e.type)).toEqual(['invoice.paid']);
	});

	it('refuses a different amount', async () => {
		const inv = await makeInvoice();
		expect(await settleInvoice(ctx, inv, { providerRef: 'pay-1', amount: 100 })).toBe('amount_mismatch');
		expect(await db.select().from(ledger)).toHaveLength(0);
	});

	it('honours money that arrives after expiry', async () => {
		const inv = await makeInvoice();
		expect(await endInvoice(ctx, inv, 'expired', { swept: true })).toBe(true);
		expect(await settleInvoice(ctx, inv, { providerRef: 'late', amount: 49_900 })).toBe('settled');
		const types = (await db.select().from(event)).map((e) => e.type);
		expect(types).toEqual(['invoice.expired', 'invoice.paid']);
	});
});

describe('endInvoice', () => {
	it('ends a pending invoice once and never a paid one', async () => {
		const inv = await makeInvoice();
		expect(await endInvoice(ctx, inv, 'expired', { swept: true })).toBe(true);
		expect(await endInvoice(ctx, inv, 'expired')).toBe(false);
		const paid = await makeInvoice({ status: 'paid' });
		expect(await endInvoice(ctx, paid, 'failed')).toBe(false);
		expect((await db.select().from(event)).map((e) => e.type)).toEqual(['invoice.expired']);
	});
});
