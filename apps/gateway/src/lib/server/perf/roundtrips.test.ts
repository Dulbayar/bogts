/**
 * Round-trip budget of the dashboard's loads (docs/performance.md). D1 charges
 * latency per round trip, so a page must not drift back to serial awaits.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { countQueries, createTestDb, seedPlan, seedProject, testConfig, type QueryStats, type TestDb } from '../testdb';
import { emitEvent } from '../events/emit';
import { overview } from '../admin/overview';
import { eventsPage, getEventDetail } from '../admin/events';
import { invoicesPage, getInvoiceDetail } from '../admin/invoices';
import { chargesPage } from '../admin/charges';
import { getSubscriptionDetail, subscriptionsPage } from '../admin/subscriptions';
import { listProjects, projectOptions } from '../admin/projects';
import { usageTable } from '../admin/usage';
import { monthOf } from '$lib/format';

let db: TestDb;
let stats: QueryStats;
let projectId: string;
let eventId: string;

beforeEach(async () => {
	db = createTestDb();
	({
		project: { id: projectId }
	} = await seedProject(db));
	await seedPlan(db, projectId);
	({ id: eventId } = await emitEvent(db, { projectId, type: 'invoice.expired', subjectId: 'X', data: {} as never }));
	stats = countQueries(db);
});

async function roundTrips(fn: () => Promise<unknown>) {
	stats.reset();
	await fn();
	return stats.roundTrips;
}

describe('round trips per load', () => {
	it('layout reads and the overview are one round trip each', async () => {
		expect(await roundTrips(() => projectOptions(db))).toBe(1);
		for (const projectId_ of [null, projectId]) {
			expect(await roundTrips(() => overview(db, testConfig(), { projectId: projectId_, period: '30d' }))).toBe(1);
		}
	});

	it('lists with their tiles are one round trip', async () => {
		const f = { projectId: null };
		expect(await roundTrips(() => eventsPage(db, f))).toBe(1);
		expect(await roundTrips(() => eventsPage(db, { projectId, state: 'failing' }))).toBe(1);
		expect(await roundTrips(() => invoicesPage(db, f))).toBe(1);
		expect(await roundTrips(() => chargesPage(db, f))).toBe(1);
		expect(await roundTrips(() => subscriptionsPage(db, f))).toBe(1);
		expect(await roundTrips(() => listProjects(db))).toBe(1);
		expect(await roundTrips(() => usageTable(db, { month: monthOf(Date.now()), projectId: null }))).toBe(1);
	});

	it('detail pages are one round trip', async () => {
		expect(await roundTrips(() => getEventDetail(db, eventId))).toBe(1);
		expect(await roundTrips(() => getInvoiceDetail(db, eventId))).toBe(1);
		expect(await roundTrips(() => getSubscriptionDetail(db, eventId))).toBe(1);
	});

	it('the failing-delivery count starts from the failing deliveries, not from every event', async () => {
		const plan = db.$sqlite
			.prepare(
				`explain query plan select count(*) from delivery where delivery.status in ('failed', 'pending') and (delivery.status = 'failed' or delivery.attempts > 0)
				 and coalesce(delivery.last_error, '') != 'no_webhook_url' and delivery.created_at >= ?
				 and not exists (select 1 from delivery d2 where d2.event_id = delivery.event_id and d2.id > delivery.id)`
			)
			.all(0) as { detail: string }[];
		const details = plan.map((r) => r.detail).join('\n');
		expect(details).toContain('delivery_status_created_idx');
		expect(details).not.toMatch(/SCAN (event|delivery)\b/);
	});
});
