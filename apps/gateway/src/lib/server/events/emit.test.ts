import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { newId } from '../ids';
import { delivery, event, invoice, ledger } from '../schema';
import { createTestDb, seedProject } from '../testdb';
import { INLINE_DELIVERY_GRACE_MS, emitEvent, eventInserts } from './emit';
import { eventJson } from './public';

const NOW = 1_800_000_000_000;

const paidData = (invoiceId: string) => ({
	invoiceId,
	provider: 'qpay' as const,
	reference: 'order-42',
	amount: 10_000,
	currency: 'MNT' as const,
	paidAt: NOW
});

describe('emitEvent', () => {
	it('writes the event and one pending delivery, and returns the event', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db);
		const e = await emitEvent(
			db,
			{ projectId: project.id, type: 'invoice.paid', subjectId: 'inv_1', data: paidData('inv_1') },
			{ now: NOW }
		);
		expect(e).toMatchObject({ projectId: project.id, type: 'invoice.paid', subjectId: 'inv_1', createdAt: NOW });

		const rows = await db.select().from(event);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: e.id, type: 'invoice.paid', data: paidData('inv_1'), dedupeKey: null });

		const deliveries = await db.select().from(delivery);
		expect(deliveries).toEqual([
			expect.objectContaining({
				id: e.deliveryId,
				eventId: e.id,
				projectId: project.id,
				status: 'pending',
				attempts: 0,
				nextAttemptAt: NOW + INLINE_DELIVERY_GRACE_MS,
				lastResponseBody: null
			})
		]);
	});

	it('also records events for a project without a webhook URL (the deliverer settles them)', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db, { webhookUrl: null });
		await emitEvent(db, { projectId: project.id, type: 'invoice.expired', subjectId: 'inv_2', data: paidData('inv_2') });
		expect(await db.select().from(delivery)).toHaveLength(1);
	});

	it('ids sort in emit order, for the feed', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db);
		const ids: string[] = [];
		for (let i = 0; i < 20; i++) {
			const e = await emitEvent(
				db,
				{ projectId: project.id, type: 'invoice.paid', subjectId: `inv_${i}`, data: paidData(`inv_${i}`) },
				{ now: NOW }
			);
			ids.push(e.id);
		}
		expect([...ids].sort()).toEqual(ids);
	});

	it('a repeated dedupeKey fails and writes nothing', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db);
		const input = {
			projectId: project.id,
			type: 'invoice.expired' as const,
			subjectId: 'inv_3',
			data: paidData('inv_3'),
			dedupeKey: 'invoice.expired:inv_3'
		};
		await emitEvent(db, input);
		await expect(emitEvent(db, input)).rejects.toThrow();
		expect(await db.select().from(event)).toHaveLength(1);
		expect(await db.select().from(delivery)).toHaveLength(1);
	});

	it('refuses an unknown project (foreign key)', async () => {
		const db = createTestDb();
		await expect(
			emitEvent(db, { projectId: 'nope', type: 'invoice.paid', subjectId: 'x', data: paidData('x') })
		).rejects.toThrow();
		expect(await db.select().from(event)).toHaveLength(0);
	});
});

describe('eventInserts in a caller batch', () => {
	it('commits with the ledger row and state change, and rolls back with them', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db);
		const invoiceId = newId();
		await db.insert(invoice).values({
			id: invoiceId,
			projectId: project.id,
			provider: 'qpay',
			amount: 10_000,
			reference: 'order-42',
			description: 'Order 42',
			expiresAt: NOW + 3_600_000,
			createdAt: NOW,
			updatedAt: NOW
		});

		const apply = () => {
			const e = eventInserts(db, { projectId: project.id, type: 'invoice.paid', subjectId: invoiceId, data: paidData(invoiceId) }, NOW);
			return db.batch([
				db.insert(ledger).values({
					id: newId(),
					projectId: project.id,
					provider: 'qpay',
					providerRef: 'payment-777',
					kind: 'invoice',
					subjectId: invoiceId,
					amount: 10_000,
					createdAt: NOW
				}),
				db.update(invoice).set({ status: 'paid', paidAt: NOW, updatedAt: NOW }).where(eq(invoice.id, invoiceId)),
				...e.statements
			]);
		};

		await apply();
		// A replayed callback: the ledger's unique (provider, provider_ref) rolls the whole batch back.
		await expect(apply()).rejects.toThrow();

		expect(await db.select().from(ledger)).toHaveLength(1);
		expect(await db.select().from(event)).toHaveLength(1);
		expect(await db.select().from(delivery)).toHaveLength(1);
		const [inv] = await db.select().from(invoice);
		expect(inv?.status).toBe('paid');
	});
});

it('eventJson is what projects receive', () => {
	const e = {
		id: '01J',
		projectId: 'p',
		type: 'invoice.paid' as const,
		subjectId: 'inv',
		data: paidData('inv'),
		createdAt: NOW
	};
	const at = new Date(NOW).toISOString();
	expect(eventJson(e)).toEqual({ id: '01J', object: 'event', type: 'invoice.paid', createdAt: at, data: { ...paidData('inv'), paidAt: at } });
});
