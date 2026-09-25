/**
 * The dashboard's per-page database cost at realistic volume (see seed.ts).
 * Skipped unless BOGTS_BENCH=1:
 *
 *   BOGTS_BENCH=1 pnpm --filter @bogts/gateway exec vitest run src/lib/server/perf/bench.test.ts
 *
 * (BOGTS_BENCH_RTT, BOGTS_BENCH_RUNS, BOGTS_BENCH_SCALE and BOGTS_BENCH_ONLY tune it.)
 *
 * For each page it runs the real layout + page loads the way SvelteKit does
 * (in parallel; a page that awaits `parent()` waits for the layout) and
 * reports: statements, D1 round trips, the wall time with a simulated D1
 * round trip of `RTT_MS` per query (serial awaits add up, a batch costs one),
 * and the SQLite time alone (no simulated latency).
 */
import { QueryPromise } from 'drizzle-orm';
import { SQLiteSelectBase } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { countQueries, createTestDb, testConfig, type QueryStats, type TestDb } from '../testdb';
import { BENCH_VOLUME, seedVolume } from './seed';
import { load as layoutLoad } from '../../../routes/admin/(app)/+layout.server';
import { load as overviewLoad } from '../../../routes/admin/(app)/+page.server';
import { load as eventsLoad } from '../../../routes/admin/(app)/events/+page.server';
import { load as paymentsLoad } from '../../../routes/admin/(app)/payments/+page.server';
import { load as chargesLoad } from '../../../routes/admin/(app)/charges/+page.server';
import { load as subscriptionsLoad } from '../../../routes/admin/(app)/subscriptions/+page.server';
import { load as projectsLoad } from '../../../routes/admin/(app)/projects/+page.server';
import { load as usageLoad } from '../../../routes/admin/(app)/usage/+page.server';
import { deliverDue, deliverFresh } from '../events/deliver';

const RTT_MS = Number(process.env.BOGTS_BENCH_RTT ?? 5);
const RUNS = Number(process.env.BOGTS_BENCH_RUNS ?? 3);
const NOW = Date.now();

let db: TestDb;
let stats: QueryStats;
let projectId: string;
let latency = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Selects get `then` by mixin (copied at load), everything else by inheritance: patch both.
const thenables = [QueryPromise.prototype, SQLiteSelectBase.prototype] as { then: QueryPromise<unknown>['then'] }[];
const originals = thenables.map((p) => p.then);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLoad = (e: any) => unknown;

function request(path: string, page: AnyLoad | null) {
	const url = new URL(`https://payments.test${path}`);
	const locals = { db, config: testConfig(), admin: { method: 'password' }, env: {}, waitUntil: () => {} };
	const layout = Promise.resolve(layoutLoad({ locals, url } as never));
	const pageP = page ? Promise.resolve(page({ locals, url, parent: () => layout })) : null;
	return Promise.all([layout, pageP]);
}

/** BOGTS_BENCH_ONLY=<regex> runs only the matching rows. */
const only = process.env.BOGTS_BENCH_ONLY ? new RegExp(process.env.BOGTS_BENCH_ONLY) : null;

async function measure(name: string, fn: () => Promise<unknown>) {
	if (only && !only.test(name)) return;
	await fn(); // warm up
	stats.reset();
	await fn();
	const { statements, roundTrips } = stats;
	let cpu = Infinity;
	for (let i = 0; i < RUNS; i++) {
		const t = performance.now();
		await fn();
		cpu = Math.min(cpu, performance.now() - t);
	}
	latency = RTT_MS;
	const t = performance.now();
	await fn();
	const wall = performance.now() - t;
	latency = 0;
	const row = { name, statements, roundTrips, [`wall@${RTT_MS}ms`]: Math.round(wall), sqliteMs: Number(cpu.toFixed(1)) };
	rows.push(row);
	process.stderr.write(`${JSON.stringify(row)}\n`);
}

const rows: Record<string, unknown>[] = [];

describe.skipIf(!process.env.BOGTS_BENCH)('dashboard cost at volume', () => {
	beforeAll(async () => {
		db = createTestDb();
		const t = performance.now();
		// BOGTS_BENCH_SCALE=0.1 seeds a tenth of the volume.
		const scale = Number(process.env.BOGTS_BENCH_SCALE ?? 1);
		const volume = Object.fromEntries(Object.entries(BENCH_VOLUME).map(([k, v]) => [k, k === 'projects' ? v : Math.round(v * scale)]));
		({ projects: [projectId] } = (await seedVolume(db, NOW, volume as typeof BENCH_VOLUME)) as { projects: [string] });
		console.log(`seeded in ${Math.round(performance.now() - t)} ms`);
		stats = countQueries(db);
		const batch = (db as unknown as { batch: (s: unknown[]) => Promise<unknown[]> }).batch;
		(db as unknown as { batch: typeof batch }).batch = async (s) => {
			if (latency) await sleep(latency);
			return batch(s);
		};
		thenables.forEach((proto, i) => {
			const then = originals[i]!;
			proto.then = function (this: QueryPromise<unknown>, ok: never, err: never) {
				if (!latency) return then.call(this, ok, err);
				return sleep(latency).then(() => then.call(this, ok, err)) as never;
			} as never;
		});
	}, 120_000);
	afterAll(() => {
		thenables.forEach((proto, i) => (proto.then = originals[i]!));
		console.table(rows);
	});

	it('measures', async () => {
		const scoped = `?project=${projectId}`;
		await measure('layout only', () => request('/admin', null));
		await measure('overview', () => request('/admin', overviewLoad));
		await measure('overview (scoped)', () => request(`/admin${scoped}`, overviewLoad));
		await measure('overview 90d', () => request('/admin?period=90d', overviewLoad));
		await measure('events', () => request('/admin/events', eventsLoad));
		await measure('events failing', () => request('/admin/events?status=failing', eventsLoad));
		await measure('events (scoped)', () => request(`/admin/events${scoped}`, eventsLoad));
		await measure('payments', () => request('/admin/payments', paymentsLoad));
		await measure('payments (scoped, failed)', () => request(`/admin/payments${scoped}&status=failed`, paymentsLoad));
		await measure('charges', () => request('/admin/charges', chargesLoad));
		await measure('subscriptions', () => request('/admin/subscriptions', subscriptionsLoad));
		await measure('subscriptions (scoped, past_due)', () => request(`/admin/subscriptions${scoped}&status=past_due`, subscriptionsLoad));
		await measure('projects', () => request('/admin/projects', projectsLoad));
		await measure('usage', () => request('/admin/usage', usageLoad));
		const ctx = { db, config: testConfig(), waitUntil: () => {}, now: NOW + 3 * 86_400_000 };
		await measure('deliverFresh (nothing fresh)', () => deliverFresh(ctx as never));
		await measure('deliverDue (nothing due)', () => deliverDue(db, testConfig(), NOW - 7 * 86_400_000));
	}, 300_000);
});
