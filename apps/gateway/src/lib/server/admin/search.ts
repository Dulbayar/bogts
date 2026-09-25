/**
 * Global search: an exact id jumps to its page; otherwise an exact
 * `reference` or `customerRef` lists the matches by type.
 */
import { eq, desc } from 'drizzle-orm';
import type { DB } from '../db';
import { charge, event, invoice, project, subscription } from '../schema';
import { isId } from './common';

/** The detail page of an exact id, or null. */
export async function findById(db: DB, raw: string): Promise<string | null> {
	const id = raw.trim().toUpperCase();
	if (!isId(id)) return null;
	const probes: [string, () => Promise<unknown[]>][] = [
		['/admin/payments/', () => db.select({ id: invoice.id }).from(invoice).where(eq(invoice.id, id)).limit(1)],
		['/admin/subscriptions/', () => db.select({ id: subscription.id }).from(subscription).where(eq(subscription.id, id)).limit(1)],
		['/admin/charges/', () => db.select({ id: charge.id }).from(charge).where(eq(charge.id, id)).limit(1)],
		['/admin/events/', () => db.select({ id: event.id }).from(event).where(eq(event.id, id)).limit(1)],
		['/admin/projects/', () => db.select({ id: project.id }).from(project).where(eq(project.id, id)).limit(1)]
	];
	for (const [prefix, probe] of probes) if ((await probe()).length) return prefix + id;
	return null;
}

/** Exact matches on `reference` (invoices, charges) and `customerRef` (subscriptions). */
export async function searchRefs(db: DB, raw: string) {
	const q = raw.trim();
	if (!q) return { invoices: [], charges: [], subscriptions: [] };
	const [invoices, charges, subscriptions] = await Promise.all([
		db
			.select({ id: invoice.id, amount: invoice.amount, status: invoice.status, reference: invoice.reference, createdAt: invoice.createdAt })
			.from(invoice)
			.where(eq(invoice.reference, q))
			.orderBy(desc(invoice.id))
			.limit(20),
		db
			.select({ id: charge.id, amount: charge.amount, status: charge.status, reference: charge.reference, createdAt: charge.createdAt })
			.from(charge)
			.where(eq(charge.reference, q))
			.orderBy(desc(charge.id))
			.limit(20),
		db
			.select({ id: subscription.id, status: subscription.status, customerRef: subscription.customerRef, createdAt: subscription.createdAt })
			.from(subscription)
			.where(eq(subscription.customerRef, q))
			.orderBy(desc(subscription.id))
			.limit(20)
	]);
	return { invoices, charges, subscriptions };
}
