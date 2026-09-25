/**
 * A realistic-volume database for the performance bench (`bench.test.ts`):
 * 5 projects, 20k invoices, 50k events with their deliveries and attempts,
 * 10k ledger rows, subscriptions, charges, activity and audit entries spread
 * over 180 days. Raw SQL in one transaction, so seeding takes about a second.
 *
 * Test scaffolding only.
 */
import { monotonicFactory } from 'ulid';
import { seedProject, type TestDb } from '../testdb';

const DAY = 86_400_000;

export type SeedVolume = {
	projects: number;
	invoices: number;
	events: number;
	ledger: number;
	subscriptions: number;
	charges: number;
	activity: number;
	audit: number;
	idempotency: number;
};

export const BENCH_VOLUME: SeedVolume = {
	projects: 5,
	invoices: 20_000,
	events: 50_000,
	ledger: 10_000,
	subscriptions: 3_000,
	charges: 4_000,
	activity: 40_000,
	audit: 2_000,
	idempotency: 5_000
};

/** A small deterministic PRNG, so every run seeds the same data. */
function rng(seed = 42) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export async function seedVolume(db: TestDb, now: number, v: SeedVolume = BENCH_VOLUME) {
	const sqlite = db.$sqlite;
	const r = rng();
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
	const weighted = <T>(xs: readonly [T, number][]): T => {
		let x = r();
		for (const [val, w] of xs) {
			if (x < w) return val;
			x -= w;
		}
		return xs[xs.length - 1]![0];
	};
	/** Sorted times over the last `days`, and ULIDs minted at them. */
	const timeline = (n: number, days = 180) => {
		const ts = Array.from({ length: n }, () => now - Math.floor(r() * days * DAY)).sort((a, b) => a - b);
		const mint = monotonicFactory();
		return ts.map((t) => ({ t, id: mint(t) }));
	};

	const projects: string[] = [];
	for (let i = 0; i < v.projects; i++) {
		projects.push((await seedProject(db, { name: `Project ${i + 1}`, now: now - 200 * DAY })).project.id);
	}

	const tx = sqlite.transaction(() => {
		/* plans + their validation entries */
		const plans: { id: string; projectId: string }[] = [];
		const insPlan = sqlite.prepare(
			`insert into plan (id, project_id, key, name, provider, provider_plan_id, amount, interval, active, created_at, updated_at)
			 values (?, ?, ?, 'Plan', 'bonum', ?, 49900, 'monthly', 1, ?, ?)`
		);
		const mintPlan = monotonicFactory();
		projects.forEach((p, i) => {
			for (const key of ['pro-monthly', 'pro-yearly']) {
				const id = mintPlan(now - 190 * DAY);
				insPlan.run(id, p, key, 100 + i, now - 190 * DAY, now - 190 * DAY);
				plans.push({ id, projectId: p });
			}
		});
		const insAudit = sqlite.prepare(`insert into audit_log (id, actor, action, subject, detail, created_at) values (?, 'password', ?, ?, ?, ?)`);
		for (const { t, id } of timeline(v.audit)) {
			const p = pick(plans);
			const validate = r() < 0.3;
			insAudit.run(id, validate ? 'plan.validate' : pick(['project.rename', 'subscription.cancel', 'charge.reverse']), validate ? p.id : p.projectId, JSON.stringify({ result: 'ok' }), t);
		}

		/* cards + subscriptions */
		const subs: { id: string; projectId: string; status: string }[] = [];
		const insCard = sqlite.prepare(
			`insert into card (id, project_id, customer_ref, provider, token_enc, mask, status, created_at, updated_at) values (?, ?, ?, 'bonum', 'x', '5150 23** **** 4778', 'active', ?, ?)`
		);
		const insSub = sqlite.prepare(
			`insert into subscription (id, project_id, plan_id, customer_ref, status, provider_subscription_id, tokenize_transaction_id, card_id, next_bill_at, cancelled_at, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const cards: { id: string; projectId: string }[] = [];
		for (const { t, id } of timeline(v.subscriptions)) {
			const pl = pick(plans);
			const cardId = `C${id.slice(1)}`;
			const customer = `cust-${Math.floor(r() * 100_000)}`;
			insCard.run(cardId, pl.projectId, customer, t, t);
			cards.push({ id: cardId, projectId: pl.projectId });
			const status = weighted([['active', 0.6], ['cancelled', 0.25], ['past_due', 0.05], ['pending', 0.05], ['failed', 0.05]] as const);
			insSub.run(id, pl.projectId, pl.id, customer, status, `ps-${id}`, `tt-${id}`, cardId, now + Math.floor(r() * 30 * DAY), status === 'cancelled' ? t + Math.floor(r() * 30 * DAY) : null, t, t);
			subs.push({ id, projectId: pl.projectId, status });
		}

		/* invoices */
		const invoices: { id: string; projectId: string; t: number; status: string }[] = [];
		const insInv = sqlite.prepare(
			`insert into invoice (id, project_id, provider, amount, currency, reference, description, status, provider_invoice_id, expires_at, swept_at, paid_at, metadata, deeplinks, created_at, updated_at)
			 values (?, ?, ?, ?, 'MNT', ?, 'Order', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const { t, id } of timeline(v.invoices)) {
			const projectId = pick(projects);
			const recent = now - t < 3600_000;
			const status = recent ? 'pending' : weighted([['paid', 0.55], ['expired', 0.35], ['failed', 0.05], ['cancelled', 0.05]] as const);
			insInv.run(
				id,
				projectId,
				r() < 0.7 ? 'qpay' : 'bonum',
				1000 * (1 + Math.floor(r() * 100)),
				`ord-${Math.floor(r() * v.invoices * 0.9)}`,
				status,
				`pi-${id}`,
				t + 1800_000,
				status === 'expired' ? t + 1900_000 : null,
				status === 'paid' ? t + 60_000 : null,
				JSON.stringify({ orderId: id }),
				JSON.stringify([{ name: 'Khan bank', link: 'khanbank://q' }]),
				t,
				t
			);
			invoices.push({ id, projectId, t, status });
		}

		/* charges */
		const insCharge = sqlite.prepare(
			`insert into charge (id, project_id, card_id, subscription_id, amount, reference, provider_transaction_id, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		for (const { t, id } of timeline(v.charges)) {
			const c = pick(cards);
			const status = weighted([['succeeded', 0.85], ['failed', 0.1], ['reversed', 0.04], ['pending', 0.01]] as const);
			insCharge.run(id, c.projectId, c.id, null, 5000, `chg-${id.slice(-6)}`, `tx-${id}`, status, t, t);
		}

		/* ledger: paid invoices first, then renewals */
		const insLedger = sqlite.prepare(
			`insert into ledger (id, project_id, provider, provider_ref, kind, subject_id, amount, period_key, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const paid = invoices.filter((i) => i.status === 'paid');
		let n = 0;
		const mintL = monotonicFactory();
		for (const inv of paid) {
			if (n >= v.ledger * 0.8) break;
			insLedger.run(mintL(inv.t + 60_000), inv.projectId, 'qpay', `pay-${inv.id}`, 'invoice', inv.id, 10_000, null, inv.t + 60_000);
			n++;
		}
		for (const { t, id } of timeline(v.ledger - n)) {
			const s = pick(subs);
			insLedger.run(id, s.projectId, 'bonum', `sub-invoice:${id}`, 'subscription', s.id, 49_900, `p-${id}`, t);
		}

		/* events + deliveries + attempts */
		const insEvent = sqlite.prepare(`insert into event (id, project_id, type, subject_id, data, dedupe_key, created_at) values (?, ?, ?, ?, ?, ?, ?)`);
		const insDelivery = sqlite.prepare(
			`insert into delivery (id, event_id, project_id, status, attempts, next_attempt_at, last_status, last_error, delivered_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insAttempt = sqlite.prepare(
			`insert into delivery_attempt (id, delivery_id, event_id, project_id, number, "trigger", url, succeeded, http_status, error, duration_ms, created_at) values (?, ?, ?, ?, ?, 'inline', 'https://project.test/hook', ?, ?, ?, 120, ?)`
		);
		const mintD = monotonicFactory();
		for (const { t, id } of timeline(v.events)) {
			const inv = pick(invoices);
			const type = weighted([['invoice.paid', 0.5], ['invoice.expired', 0.3], ['subscription.renewed', 0.1], ['charge.succeeded', 0.1]] as const);
			insEvent.run(id, inv.projectId, type, inv.id, JSON.stringify({ amount: 10_000, reference: 'ord' }), null, t);
			const age = now - t;
			const state =
				age < 90_000
					? 'fresh'
					: age < 3 * DAY
						? weighted([['succeeded', 0.94], ['retrying', 0.03], ['failed', 0.02], ['skipped', 0.01]] as const)
						: weighted([['succeeded', 0.96], ['failed', 0.03], ['skipped', 0.01]] as const);
			const dId = mintD(t);
			const status = state === 'succeeded' ? 'succeeded' : state === 'fresh' || state === 'retrying' ? 'pending' : 'failed';
			const attempts = state === 'fresh' || state === 'skipped' ? 0 : state === 'succeeded' ? 1 : 3;
			insDelivery.run(
				dId,
				id,
				inv.projectId,
				status,
				attempts,
				status === 'pending' ? (state === 'fresh' ? t + 60_000 : now + 600_000) : null,
				state === 'succeeded' ? 200 : state === 'skipped' || state === 'fresh' ? null : 500,
				state === 'skipped' ? 'no_webhook_url' : status === 'succeeded' || state === 'fresh' ? null : 'http_5xx',
				status === 'succeeded' ? t + 500 : null,
				t,
				t + 500
			);
			for (let a = 1; a <= attempts; a++) {
				insAttempt.run(mintD(t + a), dId, id, inv.projectId, a, status === 'succeeded' ? 1 : 0, status === 'succeeded' ? 200 : 500, status === 'succeeded' ? null : 'http_5xx', t + a);
			}
		}

		/* activity: mostly routine, a few "needs attention" findings */
		const insAct = sqlite.prepare(
			`insert into activity (id, project_id, subject_type, subject_id, source, kind, summary, created_at) values (?, ?, ?, ?, ?, ?, 'x', ?)`
		);
		const flagged = [
			['invoice', 'qpay.payment_refunded'],
			['invoice', 'invoice.duplicate_payment'],
			['invoice', 'qpay.extra_payment'],
			['subscription', 'bonum.subscription_payment.same_period'],
			['subscription', 'reconcile.period_conflict'],
			['subscription', 'reconcile.renewal_missing'],
			['subscription', 'reconcile.no_card'],
			['subscription', 'bonum.duplicate_live_subscription']
		] as const;
		for (const { t, id } of timeline(v.activity)) {
			if (r() < 0.01) {
				const [type, kind] = pick(flagged);
				const subj = type === 'invoice' ? pick(invoices) : pick(subs);
				insAct.run(id, subj.projectId, type, subj.id, 'gateway', kind, t);
			} else if (r() < 0.6) {
				const inv = pick(invoices);
				insAct.run(id, inv.projectId, 'invoice', inv.id, 'provider', pick(['qpay.callback.received', 'qpay.payment.checked', 'bonum.webhook.received', 'sweep.checked']), t);
			} else {
				const s = pick(subs);
				insAct.run(id, s.projectId, 'subscription', s.id, 'provider', pick(['bonum.card_token.received', 'bonum.subscription_payment.received', 'reconcile.checked']), t);
			}
		}

		/* idempotency keys, last 24 h */
		const insIdem = sqlite.prepare(`insert into idempotency (project_id, key, request_hash, status, response, created_at) values (?, ?, 'h', 200, '{}', ?)`);
		for (const { t, id } of timeline(v.idempotency, 1)) insIdem.run(pick(projects), id, t);
	});
	tx();
	// No ANALYZE: D1 does not guarantee planner statistics, so plans must be good without them.
	return { projects };
}
