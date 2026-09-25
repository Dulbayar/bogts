import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { decrypt } from '../crypto';
import { emitEvent } from '../events/emit';
import { eventJson } from '../events/public';
import { newId } from '../ids';
import { recordActivity } from '../activity';
import { recordAudit } from '../audit';
import { card, charge, cronHeartbeat, delivery, invoice, ledger, project, subscription } from '../schema';
import { createTestDb, seedPlan, seedProject, testConfig, TEST_ENCRYPTION_KEY, type TestDb } from '../testdb';
import { finishPage } from './common';
import { chargeCounts, getChargeDetail, listCharges } from './charges';
import { eventCounts, failingDeliveryCount, getEventDetail, listEvents } from './events';
import { cronStatus, deploymentMode, providerHealth } from './health';
import { getInvoiceDetail, invoiceCounts, listInvoices } from './invoices';
import { overview, periodWindow } from './overview';
import {
	archiveProject,
	createProject,
	listProjects,
	parsePlanInput,
	parseWebhookUrl,
	planChecks,
	projectPlans,
	removePlan,
	rotateWebhookSecret,
	savePlan,
	slugify
} from './projects';
import { findById, searchRefs } from './search';
import { getSubscriptionDetail, listSubscriptions, subscriptionCounts } from './subscriptions';
import { monthBounds } from '../usage';
import { monthFrom, usageTable } from './usage';

const NOW = Date.UTC(2026, 8, 25, 6, 0, 0);
const admin = { method: 'password' } as const;

let db: TestDb;

async function seedInvoice(projectId: string, over: Partial<typeof invoice.$inferInsert> = {}) {
	const id = newId();
	await db.insert(invoice).values({
		id,
		projectId,
		provider: 'qpay',
		amount: 49_000,
		reference: `ord-${id.slice(-4)}`,
		description: 'Pro plan',
		expiresAt: NOW + 1800_000,
		createdAt: NOW - 1000,
		updatedAt: NOW - 1000,
		...over
	});
	return id;
}

async function seedSubscription(projectId: string, planId: string, status: 'active' | 'past_due' | 'pending' = 'active') {
	const cardId = newId();
	await db.insert(card).values({
		id: cardId,
		projectId,
		customerRef: 'cust_8841',
		mask: '5150 23** **** 4778',
		expiry: '2028/09',
		bankName: 'Khan Bank',
		createdAt: NOW - 5000,
		updatedAt: NOW - 5000
	});
	const id = newId();
	await db.insert(subscription).values({
		id,
		projectId,
		planId,
		customerRef: 'cust_8841',
		email: 'ops@acme.mn',
		status,
		tokenizeTransactionId: newId(),
		cardId,
		nextBillAt: NOW + 30 * 86_400_000,
		createdAt: NOW - 5000,
		updatedAt: NOW - 5000
	});
	return { id, cardId };
}

beforeEach(() => {
	db = createTestDb();
});

describe('paging', () => {
	it('computes newer/older cursors', () => {
		const rows = Array.from({ length: 4 }, (_, i) => ({ id: String(9 - i) }));
		expect(finishPage(rows, {}, 3)).toEqual({ rows: rows.slice(0, 3), newer: null, older: '7' });
		expect(finishPage(rows.slice(0, 2), { before: 'x' }, 3)).toEqual({ rows: rows.slice(0, 2), newer: '9', older: null });
		const asc = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
		expect(finishPage(asc, { after: '0' }, 3)).toEqual({ rows: [{ id: '3' }, { id: '2' }, { id: '1' }], newer: '3', older: '1' });
	});
});

describe('payments', () => {
	it('lists with filters, counts and a merged timeline', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const paid = await seedInvoice(p.id, { status: 'paid', paidAt: NOW });
		await seedInvoice(p.id, { status: 'expired', provider: 'bonum' });
		await seedInvoice(p.id);
		await db.insert(ledger).values({
			id: newId(),
			projectId: p.id,
			provider: 'qpay',
			providerRef: 'QP-1',
			kind: 'invoice',
			subjectId: paid,
			amount: 49_000,
			createdAt: NOW
		});
		await recordActivity(db, { projectId: p.id, subjectType: 'invoice', subjectId: paid, source: 'provider', kind: 'qpay.callback.received', summary: 'Callback received' }, NOW - 10);
		await emitEvent(db, {
			projectId: p.id,
			type: 'invoice.paid',
			subjectId: paid,
			data: { invoiceId: paid, provider: 'qpay', reference: 'x', amount: 49_000, currency: 'MNT' }
		}, { now: NOW + 5 });

		const page = await listInvoices(db, { projectId: null, status: 'paid' });
		expect(page.rows.map((r) => r.id)).toEqual([paid]);
		expect(page.rows[0]!.projectName).toBe('Nomad Coffee');
		expect((await listInvoices(db, { projectId: p.id, provider: 'bonum' })).rows).toHaveLength(1);
		expect(await invoiceCounts(db, { projectId: null })).toEqual({ all: 3, paid: 1, expired: 1, pending: 1 });

		const detail = await getInvoiceDetail(db, paid);
		expect(detail!.timeline.map((t) => t.source)).toEqual(['event', 'provider', 'provider', 'gateway']);
		expect(detail!.events[0]!.delivery!.state).toBe('queued');
		expect(await getInvoiceDetail(db, newId())).toBeNull();
	});
});

describe('subscriptions and charges', () => {
	it('lists subscriptions and builds the detail', async () => {
		const { project: p } = await seedProject(db);
		const pl = await seedPlan(db, p.id);
		const { id } = await seedSubscription(p.id, pl.id, 'past_due');
		const page = await listSubscriptions(db, { projectId: p.id, status: 'past_due' });
		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]!.planKey).toBe('pro-monthly');
		expect(await subscriptionCounts(db, { projectId: null })).toEqual({ all: 1, past_due: 1 });
		const d = await getSubscriptionDetail(db, id);
		expect(d!.card!.bankName).toBe('Khan Bank');
		expect(d!.cardHistory).toHaveLength(1);
	});

	it('lists charges; processing covers pending and queued', async () => {
		const { project: p } = await seedProject(db);
		const pl = await seedPlan(db, p.id);
		const { id: subId, cardId } = await seedSubscription(p.id, pl.id);
		for (const status of ['pending', 'queued', 'succeeded'] as const) {
			await db.insert(charge).values({
				id: newId(),
				projectId: p.id,
				cardId,
				subscriptionId: subId,
				amount: 10_000,
				reference: `c-${status}`,
				providerTransactionId: newId(),
				status,
				createdAt: NOW,
				updatedAt: NOW
			});
		}
		expect((await listCharges(db, { projectId: null, status: 'pending' })).rows).toHaveLength(2);
		expect(await chargeCounts(db, { projectId: null })).toEqual({ all: 3, pending: 2, succeeded: 1 });
		const [first] = (await listCharges(db, { projectId: null })).rows;
		const d = await getChargeDetail(db, first!.id);
		expect(d!.card.customerRef).toBe('cust_8841');
	});
});

describe('events', () => {
	it('rolls up delivery state and counts', async () => {
		const { project: p } = await seedProject(db);
		const data = { invoiceId: 'x', provider: 'qpay' as const, reference: 'r', amount: 5, currency: 'MNT' as const };
		const ok = await emitEvent(db, { projectId: p.id, type: 'invoice.paid', subjectId: 'A', data });
		const retry = await emitEvent(db, { projectId: p.id, type: 'invoice.paid', subjectId: 'B', data });
		const skipped = await emitEvent(db, { projectId: p.id, type: 'invoice.expired', subjectId: 'C', data });
		await db.update(delivery).set({ status: 'succeeded', attempts: 1, lastStatus: 200 }).where(eq(delivery.id, ok.deliveryId));
		await db.update(delivery).set({ attempts: 2, lastStatus: 500, lastError: 'http_500' }).where(eq(delivery.id, retry.deliveryId));
		await db.update(delivery).set({ status: 'failed', lastError: 'no_webhook_url' }).where(eq(delivery.id, skipped.deliveryId));

		const counts = await eventCounts(db, { projectId: null });
		expect(counts).toEqual({ all: 3, succeeded: 1, retrying: 1, failed: 0 });
		const retrying = await listEvents(db, { projectId: null, state: 'retrying' });
		expect(retrying.rows.map((r) => r.id)).toEqual([retry.id]);
		expect(retrying.rows[0]!.subjectHref).toBe('/admin/payments/B');
		expect(await failingDeliveryCount(db, null)).toBe(1);

		// `failing` is retrying plus failed (not skipped), the rows Overview counts and links to.
		const gaveUp = await emitEvent(db, { projectId: p.id, type: 'invoice.paid', subjectId: 'D', data });
		await db.update(delivery).set({ status: 'failed', attempts: 8, lastError: 'timeout' }).where(eq(delivery.id, gaveUp.deliveryId));
		const failing = await listEvents(db, { projectId: null, state: 'failing' });
		expect(failing.rows.map((r) => r.id).sort()).toEqual([retry.id, gaveUp.id].sort());
		expect(await failingDeliveryCount(db, null)).toBe(2);
		const o = await overview(db, testConfig(), { projectId: null, period: '30d' });
		const item = o.attention.find((a) => a.text.includes('failing'))!;
		expect(item.text).toContain('**2**');
		expect(item.href).toBe(`/admin/events?status=failing&project=${p.id}`);

		const d = await getEventDetail(db, retry.id);
		expect(d!.delivery!.state).toBe('retrying');
		// Exactly what is delivered: ISO times, no internal subjectId.
		expect(d!.event.payload).toEqual(eventJson(retry));
		expect(d!.event.payload).toMatchObject({ id: retry.id, object: 'event', createdAt: new Date(retry.createdAt).toISOString() });
		expect(d!.event.payload).not.toHaveProperty('subjectId');
		expect(d!.attempts).toEqual([]);
	});
});

describe('projects', () => {
	it('creates a project with secrets shown once and stored safely', async () => {
		const created = await createProject(db, TEST_ENCRYPTION_KEY, { name: 'Nomad Coffee', webhookUrl: null });
		const again = await createProject(db, TEST_ENCRYPTION_KEY, { name: 'Nomad Coffee', webhookUrl: null });
		const [row] = await db.select().from(project).where(eq(project.id, created.id));
		expect(row!.slug).toBe('nomad-coffee');
		expect(row!.apiKeyHash).not.toContain(created.apiKey);
		expect(await decrypt(row!.webhookSecretEnc, TEST_ENCRYPTION_KEY)).toBe(created.webhookSecret);
		const [row2] = await db.select().from(project).where(eq(project.id, again.id));
		expect(row2!.slug).toBe('nomad-coffee-2');

		const secret = await rotateWebhookSecret(db, TEST_ENCRYPTION_KEY, created.id);
		const [row3] = await db.select().from(project).where(eq(project.id, created.id));
		expect(await decrypt(row3!.webhookSecretEnc, TEST_ENCRYPTION_KEY)).toBe(secret);

		const list = await listProjects(db);
		expect(list).toHaveLength(2);
	});

	it('refuses to archive with live subscriptions', async () => {
		const { project: p } = await seedProject(db);
		const pl = await seedPlan(db, p.id);
		await seedSubscription(p.id, pl.id);
		await expect(archiveProject(db, p.id)).rejects.toThrow(/active subscriptions/);
	});

	it('validates webhook URLs', () => {
		expect(parseWebhookUrl('', false)).toBeNull();
		expect(parseWebhookUrl('https://a.mn/hook', false)).toBe('https://a.mn/hook');
		expect(() => parseWebhookUrl('http://localhost:3000/h', false)).toThrow();
		expect(parseWebhookUrl('http://localhost:3000/h', true)).toBe('http://localhost:3000/h');
		expect(() => parseWebhookUrl('http://a.mn', true)).toThrow();
		expect(slugify('Steppe Books Café!')).toBe('steppe-books-cafe');
	});

	it('plans: CRUD, validation status from the audit trail', async () => {
		const { project: p } = await seedProject(db);
		const form = new FormData();
		form.set('key', 'pro-monthly');
		form.set('providerPlanId', '166');
		form.set('amount', '49,000');
		form.set('interval', 'monthly');
		const input = parsePlanInput(form);
		expect(input.amount).toBe(49_000);
		const pl = await savePlan(db, p.id, input, null, NOW);
		await expect(savePlan(db, p.id, input, null, NOW)).rejects.toThrow(/already has/);

		expect((await planChecks(db, [pl])).get(pl.id)!.status).toBe('unchecked');
		await recordAudit(db, { admin, action: 'plan.validate', subject: pl.id, detail: { result: 'mismatch', problems: ['amount'] } }, NOW + 1);
		expect((await planChecks(db, [pl])).get(pl.id)!.status).toBe('mismatch');
		// An edit resets the check.
		const edited = await savePlan(db, p.id, { ...input, amount: 45_000 }, pl.id, NOW + 2);
		expect((await planChecks(db, [edited])).get(pl.id)!.status).toBe('unchecked');

		const plans = await projectPlans(db, p.id);
		expect(plans[0]!.amount).toBe(45_000);
		expect(await removePlan(db, p.id, pl.id)).toBe('deleted');
	});
});

describe('overview, usage, search, health', () => {
	it('shows the setup checklist on a fresh install', async () => {
		const o = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW });
		expect(o.setup).toEqual({ providers: true });
	});

	it('sums volume, suppresses rates on tiny bases, flags attention', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee', webhookUrl: null });
		const inv = await seedInvoice(p.id, { status: 'paid', createdAt: NOW - 3600_000 });
		await db.insert(ledger).values([
			{ id: newId(), projectId: p.id, provider: 'qpay', providerRef: 'a', kind: 'invoice', subjectId: inv, amount: 49_000, createdAt: NOW - 3600_000 },
			{ id: newId(), projectId: p.id, provider: 'bonum', providerRef: 'b', kind: 'charge', subjectId: 'c', amount: -9_000, createdAt: NOW - 1800_000 }
		]);
		const o = await overview(db, testConfig(), { projectId: null, period: '7d', now: NOW });
		expect(o.kpis!.volume).toBe(40_000);
		expect(o.kpis!.payments).toBe(1);
		expect(o.kpis!.successRate).toBeNull();
		expect(o.daily).toHaveLength(7);
		expect(o.daily.at(-1)!.volume).toBe(40_000);
		expect(o.attention.some((a) => a.text.includes('no webhook URL'))).toBe(true);

		const usage = await usageTable(db, { month: '2026-09', projectId: null });
		expect(usage.lines[0]).toMatchObject({ name: 'Nomad Coffee', payments: 2, volume: 40_000, invoices: 1, charges: 0 });
	});

	it('KPIs use the same Ulaanbaatar calendar days as the chart', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const { start, end } = periodWindow(30, NOW);
		// NOW is 14:00 in UB; the window starts at UB midnight 29 days back.
		expect(start).toBe(Date.UTC(2026, 7, 26, 16, 0, 0));
		expect(end).toBe(Date.UTC(2026, 8, 25, 16, 0, 0));
		const row = (amount: number, createdAt: number) => ({
			id: newId(),
			projectId: p.id,
			provider: 'qpay' as const,
			providerRef: newId(),
			kind: 'invoice' as const,
			subjectId: newId(),
			amount,
			createdAt
		});
		await db.insert(ledger).values([row(1_000, start - 1), row(2_000, start), row(4_000, NOW - 1000), row(8_000, NOW - 30 * 86_400_000 + 3600_000)]);
		const o = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW });
		const bars = o.daily.reduce((n, d) => n + d.volume, 0);
		expect(bars).toBe(6_000);
		expect(o.kpis!.volume).toBe(bars);
		expect(o.kpis!.payments).toBe(o.daily.reduce((n, d) => n + d.count, 0));
	});

	it('usage months are Ulaanbaatar calendar months', async () => {
		expect(monthBounds('2026-09')).toEqual({ start: Date.UTC(2026, 7, 31, 16), end: Date.UTC(2026, 8, 30, 16) });
		// 1 September 01:00 in UB is still August in UTC.
		const earlySept = Date.UTC(2026, 7, 31, 17);
		expect(monthFrom(new URL('https://p.test/admin/usage'), earlySept)).toBe('2026-09');
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const row = (amount: number, createdAt: number) => ({
			id: newId(),
			projectId: p.id,
			provider: 'qpay' as const,
			providerRef: newId(),
			kind: 'invoice' as const,
			subjectId: newId(),
			amount,
			createdAt
		});
		await db.insert(ledger).values([row(1_000, earlySept), row(2_000, Date.UTC(2026, 7, 31, 15))]);
		expect((await usageTable(db, { month: '2026-09', projectId: null })).total.volume).toBe(1_000);
		expect((await usageTable(db, { month: '2026-08', projectId: null })).total.volume).toBe(2_000);
	});

	it('ignores archived projects in plan and Bonum checks', async () => {
		const { project: p } = await seedProject(db, { name: 'Old' });
		const pl = await seedPlan(db, p.id, { now: NOW - 1000 });
		await recordAudit(db, { admin, action: 'plan.validate', subject: pl.id, detail: { result: 'mismatch', problems: ['amount'] } }, NOW);
		const noBonum = testConfig({ bonum: null, providers: { bonum: false, qpay: true } });
		let texts = (await overview(db, noBonum, { projectId: null, period: '30d', now: NOW })).attention.map((a) => a.text);
		expect(texts.some((t) => t.includes("doesn't match Bonum"))).toBe(true);
		expect(texts.some((t) => t.includes('**Bonum** is not configured'))).toBe(true);
		await db.update(project).set({ archivedAt: NOW }).where(eq(project.id, p.id));
		texts = (await overview(db, noBonum, { projectId: null, period: '30d', now: NOW })).attention.map((a) => a.text);
		expect(texts.some((t) => t.includes('Bonum'))).toBe(false);
	});

	it('flags charges with no result after an hour and duplicate live mandates', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const pl = await seedPlan(db, p.id);
		const { id: subId, cardId } = await seedSubscription(p.id, pl.id);
		const chargeRow = (status: 'pending' | 'succeeded', createdAt: number) => ({
			id: newId(),
			projectId: p.id,
			cardId,
			amount: 15_000,
			reference: `c-${createdAt}`,
			providerTransactionId: newId(),
			status,
			createdAt,
			updatedAt: createdAt
		});
		await db.insert(charge).values([chargeRow('pending', NOW - 2 * 3600_000), chargeRow('pending', NOW - 60_000), chargeRow('succeeded', NOW - 5 * 3600_000)]);
		await recordActivity(db, {
			projectId: p.id,
			subjectType: 'subscription',
			subjectId: subId,
			source: 'provider',
			kind: 'bonum.duplicate_live_subscription',
			summary: 'Two live mandates'
		});
		const o = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW });
		const texts = o.attention.map((a) => a.text);
		expect(texts.filter((t) => t.includes('no result after an hour'))).toHaveLength(1);
		expect(o.attention.find((a) => a.text.includes('two live Bonum'))!.href).toBe(`/admin/subscriptions/${subId}`);
	});

	it('flags references paid twice and QPay invoices paid more than once', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const first = await seedInvoice(p.id, { reference: 'order-9', status: 'paid', paidAt: NOW - 5000 });
		const second = await seedInvoice(p.id, { reference: 'order-9', status: 'paid', paidAt: NOW - 1000 });
		await seedInvoice(p.id, { reference: 'order-9', status: 'cancelled' });
		await recordActivity(db, { projectId: p.id, subjectType: 'invoice', subjectId: second, source: 'gateway', kind: 'invoice.duplicate_payment', summary: 'Paid twice' }, NOW - 1000);
		await recordActivity(db, { projectId: p.id, subjectType: 'invoice', subjectId: first, source: 'provider', kind: 'qpay.extra_payment', summary: 'Extra' }, NOW - 1000);
		let o = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW });
		const twice = o.attention.find((a) => a.text.includes('paid twice'))!;
		expect(twice).toMatchObject({ tone: 'danger', text: '**1** reference paid twice: refund one', href: `/admin/payments?reference=order-9&project=${p.id}` });
		expect(o.attention.find((a) => a.text.includes('more than once'))!.href).toBe(`/admin/payments/${first}`);
		// The filtered list shows that purchase's invoices only.
		const page = await listInvoices(db, { projectId: p.id, reference: 'order-9' });
		expect(page.rows).toHaveLength(3);
		expect((await invoiceCounts(db, { projectId: p.id, reference: 'order-9' })).all).toBe(3);
		// Old sightings drop off.
		o = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW + 31 * 86_400_000 });
		expect(o.attention.some((a) => a.text.includes('paid twice') || a.text.includes('more than once'))).toBe(false);
	});

	it('lists refunds and reconciliation findings, one line per kind with a count, for 30 days', async () => {
		const { project: p } = await seedProject(db, { name: 'Nomad Coffee' });
		const pl = await seedPlan(db, p.id);
		const inv = await seedInvoice(p.id, { status: 'paid', paidAt: NOW - 5000 });
		const [a, b, c] = [await seedSubscription(p.id, pl.id), await seedSubscription(p.id, pl.id), await seedSubscription(p.id, pl.id)];
		const note = (subjectType: 'invoice' | 'subscription', subjectId: string, kind: string, at = NOW - 1000) =>
			recordActivity(db, { projectId: p.id, subjectType, subjectId, source: 'gateway', kind, summary: kind }, at);
		await note('invoice', inv, 'qpay.payment_refunded');
		await note('subscription', a.id, 'reconcile.period_conflict', NOW - 3000);
		await note('subscription', b.id, 'reconcile.period_unknown', NOW - 2000);
		await note('subscription', b.id, 'reconcile.period_unknown', NOW - 1000); // the same subscription again
		await note('subscription', a.id, 'reconcile.renewal_missing');
		await note('subscription', b.id, 'reconcile.no_card');
		await note('subscription', c.id, 'reconcile.provider_cancelled');
		await note('subscription', c.id, 'bonum.subscription_payment.same_period');
		await note('subscription', c.id, 'reconcile.provider_error'); // not a flag
		const o = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW });
		const find = (t: string) => o.attention.find((i) => i.text.includes(t));
		expect(find('refunded')).toEqual({ tone: 'warning', text: '**1** paid QPay invoice shows its payment refunded', href: `/admin/payments/${inv}` });
		expect(find("couldn't be credited")).toEqual({
			tone: 'danger',
			text: "**2** subscriptions with a Bonum charge that couldn't be credited: check Bonum",
			href: `/admin/subscriptions/${b.id}`
		});
		expect(find('missing a renewal')).toMatchObject({ text: '**1** subscription missing a renewal at Bonum', href: `/admin/subscriptions/${a.id}` });
		expect(find('no saved card')).toMatchObject({ href: `/admin/subscriptions/${b.id}` });
		expect(find('cancelled at Bonum')).toMatchObject({ href: `/admin/subscriptions/${c.id}` });
		expect(find('charged twice')).toMatchObject({ tone: 'danger', href: `/admin/subscriptions/${c.id}` });
		expect(o.attention.filter((i) => i.text.includes('Bonum charge'))).toHaveLength(1);
		// Scoped to a project, and gone after 30 days.
		const other = (await seedProject(db, { name: 'Other' })).project.id;
		expect((await overview(db, testConfig(), { projectId: other, period: '30d', now: NOW })).attention.some((i) => i.text.includes('refunded'))).toBe(false);
		const later = await overview(db, testConfig(), { projectId: null, period: '30d', now: NOW + 31 * 86_400_000 });
		expect(later.attention.some((i) => /refunded|credited|renewal|saved card|without a webhook|charged twice/.test(i.text))).toBe(false);
	});

	it('finds by exact id and by reference', async () => {
		const { project: p } = await seedProject(db);
		const inv = await seedInvoice(p.id, { reference: 'order-1' });
		expect(await findById(db, inv.toLowerCase())).toBe(`/admin/payments/${inv}`);
		expect(await findById(db, 'nope')).toBeNull();
		expect((await searchRefs(db, 'order-1')).invoices).toHaveLength(1);
	});

	it('reports providers, mode and cron without secret values', async () => {
		const env = { DB: {} as D1Database, BONUM_APP_SECRET: 'x', QPAY_CLIENT_ID: 'id', QPAY_CLIENT_PASSWORD: 'pw', QPAY_INVOICE_CODE: 'c', PUBLIC_ORIGIN: 'https://p.test' };
		const config = testConfig({ bonum: null, providers: { bonum: false, qpay: true } });
		const h = providerHealth(env, config);
		expect(h.find((x) => x.id === 'bonum')!.state).toBe('incomplete');
		expect(h.find((x) => x.id === 'qpay')!.state).toBe('configured');
		expect(JSON.stringify(h)).not.toContain('pw');
		expect(deploymentMode(testConfig()).mode).toBe('sandbox');
		expect((await cronStatus(db, NOW)).stale).toBe(true);
	});

	it('reports the late check and reconcile runs, null until they have run', async () => {
		let cron = await cronStatus(db, NOW);
		expect([cron.sweep, cron.lateCheck, cron.reconcile]).toEqual([null, null, null]);
		await db.insert(cronHeartbeat).values([
			{ name: 'late_check', lastRunAt: NOW - 60_000, lastDurationMs: 5, lastError: null },
			{ name: 'reconcile', lastRunAt: NOW - 120_000, lastDurationMs: 7, lastError: null }
		]);
		cron = await cronStatus(db, NOW);
		expect(cron.lateCheck).toMatchObject({ lastRunAt: NOW - 60_000 });
		expect(cron.reconcile).toMatchObject({ lastRunAt: NOW - 120_000 });
		expect(cron.sweep).toBeNull();
	});
});
