/**
 * Every dashboard load against two projects whose names, webhook URLs and
 * statuses all differ, through the production Drizzle D1 driver (testdb.ts).
 *
 * Guards the D1 batch trap (docs/contracts.md, "As built"): batched rows come
 * back as objects keyed by column name, so a repeated name (`id`, `name`,
 * `status`, …) shifts every later field. Each load runs twice: strict (the
 * test D1 throws on any repeated result column) and exactly like production
 * (names collapse silently), where the values themselves are checked.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { emitEvent } from '$lib/server/events/emit';
import { newId } from '$lib/server/ids';
import { recordActivity } from '$lib/server/activity';
import { card, charge, delivery, invoice, ledger, subscription } from '$lib/server/schema';
import { createTestDb, seedPlan, seedProject, testConfig, type TestDb } from '$lib/server/testdb';
import { load as layoutLoad } from './+layout.server';
import { load as overviewLoad } from './+page.server';
import { load as paymentsLoad } from './payments/+page.server';
import { load as paymentLoad } from './payments/[id]/+page.server';
import { load as chargesLoad } from './charges/+page.server';
import { load as chargeLoad } from './charges/[id]/+page.server';
import { load as subscriptionsLoad } from './subscriptions/+page.server';
import { load as subscriptionLoad } from './subscriptions/[id]/+page.server';
import { load as eventsLoad } from './events/+page.server';
import { load as eventLoad } from './events/[id]/+page.server';
import { load as projectsLoad } from './projects/+page.server';
import { load as projectLoad } from './projects/[id]/+page.server';
import { load as usageLoad } from './usage/+page.server';
import { load as settingsLoad } from './settings/+page.server';
import { load as searchLoad } from './search/+page.server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loaded = any;
type AnyLoad = (e: unknown) => unknown;

const NOW = Date.now();

type Side = {
	projectId: string;
	name: string;
	webhookUrl: string;
	planId: string;
	planName: string;
	invoiceId: string;
	invoiceStatus: 'paid' | 'pending';
	invoiceRef: string;
	subscriptionId: string;
	subscriptionStatus: 'active' | 'past_due';
	chargeId: string;
	chargeStatus: 'succeeded' | 'failed';
	eventId: string;
	cardMask: string;
};

let db: TestDb;
let a: Side;
let b: Side;

async function seedSide(
	name: string,
	webhookUrl: string,
	opts: { planKey: string; providerPlanId: number; invoiceStatus: Side['invoiceStatus']; subscriptionStatus: Side['subscriptionStatus']; chargeStatus: Side['chargeStatus']; mask: string }
): Promise<Side> {
	const { project: p } = await seedProject(db, { name, webhookUrl, now: NOW - 10_000 });
	const pl = await seedPlan(db, p.id, { key: opts.planKey, providerPlanId: opts.providerPlanId, now: NOW - 9000 });
	const invoiceId = newId();
	const invoiceRef = `${opts.planKey}-order`;
	await db.insert(invoice).values({
		id: invoiceId,
		projectId: p.id,
		provider: 'qpay',
		amount: 49_000,
		reference: invoiceRef,
		description: `${name} purchase`,
		status: opts.invoiceStatus,
		paidAt: opts.invoiceStatus === 'paid' ? NOW - 500 : null,
		metadata: { orderOf: name },
		expiresAt: NOW + 1800_000,
		createdAt: NOW - 1000,
		updatedAt: NOW - 1000
	});
	if (opts.invoiceStatus === 'paid') {
		await db.insert(ledger).values({
			id: newId(),
			projectId: p.id,
			provider: 'qpay',
			providerRef: `QP-${invoiceId}`,
			kind: 'invoice',
			subjectId: invoiceId,
			amount: 49_000,
			createdAt: NOW - 500
		});
	}
	await recordActivity(db, { projectId: p.id, subjectType: 'invoice', subjectId: invoiceId, source: 'provider', kind: 'qpay.callback.received', summary: 'Callback received' }, NOW - 400);
	const cardId = newId();
	await db.insert(card).values({
		id: cardId,
		projectId: p.id,
		customerRef: `cust-${opts.planKey}`,
		mask: opts.mask,
		expiry: '2029/01',
		bankName: `${name} Bank`,
		createdAt: NOW - 5000,
		updatedAt: NOW - 5000
	});
	const subscriptionId = newId();
	await db.insert(subscription).values({
		id: subscriptionId,
		projectId: p.id,
		planId: pl.id,
		customerRef: `cust-${opts.planKey}`,
		email: `ops@${opts.planKey}.mn`,
		status: opts.subscriptionStatus,
		tokenizeTransactionId: newId(),
		cardId,
		nextBillAt: NOW + 30 * 86_400_000,
		createdAt: NOW - 5000,
		updatedAt: NOW - 5000
	});
	const chargeId = newId();
	await db.insert(charge).values({
		id: chargeId,
		projectId: p.id,
		cardId,
		subscriptionId,
		amount: 10_000,
		reference: `${opts.planKey}-charge`,
		providerTransactionId: newId(),
		status: opts.chargeStatus,
		createdAt: NOW - 3000,
		updatedAt: NOW - 3000
	});
	const ev = await emitEvent(
		db,
		{ projectId: p.id, type: 'invoice.paid', subjectId: invoiceId, data: { invoiceId, provider: 'qpay', reference: invoiceRef, amount: 49_000, currency: 'MNT' } },
		{ now: NOW - 200 }
	);
	return {
		projectId: p.id,
		name,
		webhookUrl,
		planId: pl.id,
		planName: pl.name,
		invoiceId,
		invoiceStatus: opts.invoiceStatus,
		invoiceRef,
		subscriptionId,
		subscriptionStatus: opts.subscriptionStatus,
		chargeId,
		chargeStatus: opts.chargeStatus,
		eventId: ev.id,
		cardMask: opts.mask
	};
}

function event(path: string, params: Record<string, string> = {}) {
	const url = new URL(`https://payments.test${path}`);
	const locals = { db, config: testConfig(), admin: { method: 'password' }, env: {}, waitUntil: () => {} };
	return { locals, url, params, parent: async () => ({}) };
}

async function run(load: unknown, path: string, params: Record<string, string> = {}): Promise<Loaded> {
	return (load as AnyLoad)(event(path, params));
}

beforeEach(async () => {
	db = createTestDb();
	a = await seedSide('Alpha Coffee', 'https://alpha.test/hooks/bogts', {
		planKey: 'alpha-monthly',
		providerPlanId: 101,
		invoiceStatus: 'paid',
		subscriptionStatus: 'active',
		chargeStatus: 'succeeded',
		mask: '4000 00** **** 0001'
	});
	b = await seedSide('Bravo Books', 'https://bravo.test/in', {
		planKey: 'bravo-yearly',
		providerPlanId: 202,
		invoiceStatus: 'pending',
		subscriptionStatus: 'past_due',
		chargeStatus: 'failed',
		mask: '5000 00** **** 0002'
	});
	// A's delivery succeeded; B's is retrying (failing), and one B event has no delivery row at all.
	await db.update(delivery).set({ status: 'succeeded', attempts: 1, lastStatus: 200, deliveredAt: NOW - 100 }).where(eq(delivery.eventId, a.eventId));
	await db.update(delivery).set({ attempts: 2, lastStatus: 500, lastError: 'http_500' }).where(eq(delivery.eventId, b.eventId));
	const orphan = await emitEvent(db, { projectId: b.projectId, type: 'invoice.expired', subjectId: b.invoiceId, data: {} as never }, { now: NOW - 150 });
	await db.delete(delivery).where(eq(delivery.eventId, orphan.id));
});

for (const strict of [true, false]) {
	describe(`admin loads (${strict ? 'strict columns' : 'exactly like D1'})`, () => {
		beforeEach(() => {
			db.$d1.strictColumns = strict;
		});

		it('layout: project switcher and failing badge', async () => {
			const d = await run(layoutLoad, '/admin');
			const byId = new Map(d.projects.map((p: Loaded) => [p.id, p]));
			expect(byId.get(a.projectId)).toEqual({ id: a.projectId, name: a.name, archived: false, failing: false });
			expect(byId.get(b.projectId)).toEqual({ id: b.projectId, name: b.name, archived: false, failing: true });
			expect(d.failing).toBe(1);
		});

		it('overview', async () => {
			const d = await run(overviewLoad, '/admin');
			expect(d.kpis.volume).toBe(49_000);
			expect(d.kpis.payments).toBe(1);
			expect(d.kpis.activeSubscriptions).toBe(1);
			const recent = new Map(d.recent.map((r: Loaded) => [r.id, r]));
			expect(recent.get(a.eventId)).toMatchObject({ projectName: a.name, subjectId: a.invoiceId, amount: 49_000 });
			expect((recent.get(a.eventId) as Loaded).delivery.state).toBe('succeeded');
			expect((recent.get(b.eventId) as Loaded).delivery.state).toBe('retrying');
			expect([...recent.values()].find((r: Loaded) => r.id !== a.eventId && r.id !== b.eventId)).toMatchObject({ projectName: b.name, delivery: null });
			const health = new Map(d.health.map((h: Loaded) => [h.id, h]));
			expect(health.get(a.projectId)).toMatchObject({ name: a.name, webhookUrl: a.webhookUrl, delivered: 1, failing: 0 });
			expect(health.get(b.projectId)).toMatchObject({ name: b.name, webhookUrl: b.webhookUrl, delivered: 0, failing: 1 });
			expect(d.attention.map((x: Loaded) => x.text)).toContain(`**1** webhook delivery is failing for **${b.name}**`);
			const scoped = await run(overviewLoad, `/admin?project=${b.projectId}`);
			expect(scoped.recent.every((r: Loaded) => r.projectName === b.name)).toBe(true);
		});

		it('payments list and detail', async () => {
			const d = await run(paymentsLoad, '/admin/payments');
			const rows = new Map(d.page.rows.map((r: Loaded) => [r.id, r]));
			expect(rows.get(a.invoiceId)).toMatchObject({ projectId: a.projectId, projectName: a.name, status: 'paid', reference: a.invoiceRef });
			expect(rows.get(b.invoiceId)).toMatchObject({ projectId: b.projectId, projectName: b.name, status: 'pending', reference: b.invoiceRef });
			expect(d.counts).toEqual({ all: 2, paid: 1, pending: 1 });
			for (const s of [a, b]) {
				const p = await run(paymentLoad, `/admin/payments/${s.invoiceId}`, { id: s.invoiceId });
				expect(p.project).toEqual({ id: s.projectId, name: s.name, webhookUrl: s.webhookUrl });
				expect(p.invoice).toMatchObject({ id: s.invoiceId, status: s.invoiceStatus, reference: s.invoiceRef, description: `${s.name} purchase`, metadata: { orderOf: s.name } });
				expect(p.events.map((e: Loaded) => e.id)).toContain(s.eventId);
			}
		});

		it('charges list and detail', async () => {
			const d = await run(chargesLoad, '/admin/charges');
			const rows = new Map(d.page.rows.map((r: Loaded) => [r.id, r]));
			expect(rows.get(a.chargeId)).toMatchObject({ projectName: a.name, status: a.chargeStatus, cardMask: a.cardMask });
			expect(rows.get(b.chargeId)).toMatchObject({ projectName: b.name, status: b.chargeStatus, cardMask: b.cardMask });
			expect(d.counts).toEqual({ all: 2, succeeded: 1, failed: 1 });
			for (const s of [a, b]) {
				const c = await run(chargeLoad, `/admin/charges/${s.chargeId}`, { id: s.chargeId });
				expect(c.project).toEqual({ id: s.projectId, name: s.name });
				expect(c.charge).toMatchObject({ id: s.chargeId, status: s.chargeStatus, subscriptionId: s.subscriptionId });
				expect(c.card).toMatchObject({ mask: s.cardMask, bankName: `${s.name} Bank` });
			}
		});

		it('subscriptions list and detail', async () => {
			const d = await run(subscriptionsLoad, '/admin/subscriptions');
			const rows = new Map(d.page.rows.map((r: Loaded) => [r.id, r]));
			expect(rows.get(a.subscriptionId)).toMatchObject({ projectName: a.name, status: 'active', planKey: 'alpha-monthly', cardMask: a.cardMask });
			expect(rows.get(b.subscriptionId)).toMatchObject({ projectName: b.name, status: 'past_due', planKey: 'bravo-yearly', cardMask: b.cardMask });
			expect(d.counts).toEqual({ all: 2, active: 1, past_due: 1 });
			for (const s of [a, b]) {
				const x = await run(subscriptionLoad, `/admin/subscriptions/${s.subscriptionId}`, { id: s.subscriptionId });
				expect(x.project).toEqual({ id: s.projectId, name: s.name });
				expect(x.subscription).toMatchObject({ id: s.subscriptionId, status: s.subscriptionStatus });
				expect(x.plan).toMatchObject({ id: s.planId, name: s.planName });
				expect(x.card).toMatchObject({ mask: s.cardMask, status: 'active' });
				expect(x.charges.map((c: Loaded) => [c.id, c.status])).toEqual([[s.chargeId, s.chargeStatus]]);
			}
		});

		it('events list and detail', async () => {
			const d = await run(eventsLoad, '/admin/events');
			const rows = new Map(d.page.rows.map((r: Loaded) => [r.id, r]));
			expect(rows.get(a.eventId)).toMatchObject({ projectId: a.projectId, projectName: a.name, subjectId: a.invoiceId, amount: 49_000 });
			expect((rows.get(a.eventId) as Loaded).delivery.state).toBe('succeeded');
			expect(rows.get(b.eventId)).toMatchObject({ projectId: b.projectId, projectName: b.name });
			expect((rows.get(b.eventId) as Loaded).delivery).toMatchObject({ state: 'retrying', attempts: 2, lastStatus: 500, lastError: 'http_500' });
			expect(d.page.rows.filter((r: Loaded) => r.delivery === null)).toHaveLength(1);
			expect(d.counts).toEqual({ all: 3, succeeded: 1, retrying: 1, failed: 0 });
			for (const s of [a, b]) {
				const e = await run(eventLoad, `/admin/events/${s.eventId}`, { id: s.eventId });
				expect(e.project).toEqual({ id: s.projectId, name: s.name, webhookUrl: s.webhookUrl });
				expect(e.event).toMatchObject({ id: s.eventId, type: 'invoice.paid', subjectId: s.invoiceId });
				expect(e.event.payload).toMatchObject({ id: s.eventId, data: { reference: s.invoiceRef } });
			}
		});

		it('projects list and detail tabs', async () => {
			const d = await run(projectsLoad, '/admin/projects');
			const rows = new Map(d.list.map((r: Loaded) => [r.id, r]));
			expect(rows.get(a.projectId)).toMatchObject({ name: a.name, webhookUrl: a.webhookUrl, archived: false, planCount: 1 });
			expect((rows.get(a.projectId) as Loaded).health).toMatchObject({ delivered: 1, failing: 0 });
			expect(rows.get(b.projectId)).toMatchObject({ name: b.name, webhookUrl: b.webhookUrl, archived: false, planCount: 1 });
			expect((rows.get(b.projectId) as Loaded).health).toMatchObject({ delivered: 0, failing: 1 });
			for (const s of [a, b]) {
				for (const tab of ['general', 'plans', 'webhook']) {
					const p = await run(projectLoad, `/admin/projects/${s.projectId}?tab=${tab}`, { id: s.projectId });
					expect(p.project).toMatchObject({ id: s.projectId, name: s.name, webhookUrl: s.webhookUrl });
					if (tab === 'plans') expect(p.plans).toMatchObject([{ id: s.planId, name: s.planName, active: true, subscriptions: 1 }]);
					if (tab === 'webhook') expect(p.deliveries.map((x: Loaded) => x.eventId)).toContain(s.eventId);
				}
			}
		});

		it('usage', async () => {
			const d = await run(usageLoad, '/admin/usage');
			const lines = new Map(d.lines.map((l: Loaded) => [l.projectId, l]));
			expect(lines.get(a.projectId)).toMatchObject({ name: a.name, payments: 1, volume: 49_000, invoices: 1, events: 1 });
			expect(lines.get(b.projectId)).toMatchObject({ name: b.name, payments: 0, volume: 0, events: 2 });
		});

		it('settings', async () => {
			const d = await run(settingsLoad, '/admin/settings');
			expect(d.cron).toMatchObject({ tick: null, stale: true, dueDeliveries: 0 });
			expect(d.security.mode).toBe('password');
		});

		it('search', async () => {
			const d = await run(searchLoad, `/admin/search?q=${b.invoiceRef}`);
			expect(d.results.invoices).toMatchObject([{ id: b.invoiceId, status: 'pending', reference: b.invoiceRef }]);
			await expect(run(searchLoad, `/admin/search?q=${a.chargeId}`)).rejects.toMatchObject({ status: 303, location: `/admin/charges/${a.chargeId}` });
		});
	});
}
