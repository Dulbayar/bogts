import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacSha256Hex } from '../crypto';
import { ApiError } from '../api/errors';
import { project, delivery, deliveryAttempt, type Delivery } from '../schema';
import { createTestDb, seedProject, testConfig, type TestDb } from '../testdb';
import {
	BOGTS_VERSION,
	CLAIM_LEASE_MS,
	RETRY_WINDOW_MS,
	classifyFetchError,
	deliverDue,
	deliverFresh,
	nextAttemptAfterFailure,
	redeliver,
	retryDelayMs,
	signPayload,
	truncateResponseBody,
	USER_AGENT
} from './deliver';
import { emitEvent, INLINE_DELIVERY_GRACE_MS } from './emit';
import { eventJson } from './public';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const config = testConfig();

type Sent = { url: string; headers: Headers; body: string };

/** Stubs global fetch; `respond` decides each answer. */
function stubFetch(respond: (req: Sent) => Response | Promise<Response> = () => new Response('ok')) {
	const sent: Sent[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const req = { url: String(input), headers: new Headers(init?.headers), body: String(init?.body) };
		sent.push(req);
		return respond(req);
	});
	vi.stubGlobal('fetch', fn);
	return { sent, fn };
}

afterEach(() => vi.unstubAllGlobals());

const paidData = (invoiceId: string) => ({
	invoiceId,
	provider: 'qpay' as const,
	reference: 'order-42',
	amount: 10_000,
	currency: 'MNT' as const,
	paidAt: NOW
});

async function setup(opts: { webhookUrl?: string | null; archived?: boolean } = {}) {
	const db = createTestDb();
	const seeded = await seedProject(db, { ...opts, now: NOW });
	const emit = (n = 0, at = NOW) =>
		emitEvent(db, { projectId: seeded.project.id, type: 'invoice.paid', subjectId: `inv_${n}`, data: paidData(`inv_${n}`) }, { now: at });
	return { db, ...seeded, emit };
}

const deliveryOf = async (db: TestDb, id: string): Promise<Delivery> =>
	(await db.select().from(delivery).where(eq(delivery.id, id)))[0]!;
const attemptsOf = (db: TestDb, id: string) =>
	db.select().from(deliveryAttempt).where(eq(deliveryAttempt.deliveryId, id)).orderBy(deliveryAttempt.number);

/**
 * Minimal Bogts-Signature check, local so this app stays self-contained for the
 * Deploy button. Interop with @gege-mn/bogts's verifyWebhook is tested in
 * packages/client/test/interop.test.ts.
 */
async function verifyWebhook(body: string, header: string | null, secret: string) {
	const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
	if (!match || (await hmacSha256Hex(secret, `${match[1]}.${body}`)) !== match[2]) throw new Error('bad signature');
	return JSON.parse(body) as unknown;
}

describe('signPayload', () => {
	it('produces a verifiable t=,v1= header', async () => {
		const body = JSON.stringify({ id: 'x', object: 'event', type: 'invoice.paid', createdAt: '', data: {} });
		const t = Math.floor(Date.now() / 1000);
		const header = await signPayload('bgwh_secret', t, body);
		expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
		await expect(verifyWebhook(body, header, 'bgwh_secret')).resolves.toMatchObject({ id: 'x' });
		await expect(verifyWebhook(body + ' ', header, 'bgwh_secret')).rejects.toThrow();
	});
});

describe('a delivery attempt', () => {
	it('POSTs the signed public event and records success', async () => {
		const { db, webhookSecret, emit } = await setup();
		const e = await emit();
		const { sent } = stubFetch(() => new Response('thanks', { status: 200 }));

		expect(await deliverFresh({ db, config, now: NOW + 1000 })).toBe(1);

		expect(sent).toHaveLength(1);
		const req = sent[0]!;
		expect(req.url).toBe('https://project.test/webhooks/bogts');
		expect(req.headers.get('content-type')).toBe('application/json');
		expect(req.headers.get('user-agent')).toBe(USER_AGENT);
		expect(req.headers.get('bogts-event-id')).toBe(e.id);
		expect(req.headers.get('bogts-event-type')).toBe('invoice.paid');
		const verified = await verifyWebhook(req.body, req.headers.get('bogts-signature'), webhookSecret);
		expect(verified).toEqual({
			id: e.id,
			object: 'event',
			type: 'invoice.paid',
			createdAt: new Date(NOW).toISOString(),
			data: { ...paidData('inv_0'), paidAt: new Date(NOW).toISOString() }
		});
		expect(req.body).toBe(JSON.stringify(eventJson(e)));

		const d = await deliveryOf(db, e.deliveryId);
		expect(d).toMatchObject({
			status: 'succeeded',
			attempts: 1,
			nextAttemptAt: null,
			lastStatus: 200,
			lastError: null,
			lastResponseBody: 'thanks',
			deliveredAt: NOW + 1000
		});
		expect(d.lastDurationMs).toBeGreaterThanOrEqual(0);
		const attempts = await attemptsOf(db, e.deliveryId);
		expect(attempts).toEqual([
			expect.objectContaining({ number: 1, trigger: 'inline', succeeded: true, httpStatus: 200, error: null, url: req.url })
		]);
		expect(attempts[0]!.signature).toBe(req.headers.get('bogts-signature'));
	});

	it('a 5xx is a failure, retried after 1 minute', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		stubFetch(() => new Response('boom', { status: 503 }));
		await deliverFresh({ db, config, now: NOW });
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({
			status: 'pending',
			attempts: 1,
			nextAttemptAt: NOW + MIN,
			lastStatus: 503,
			lastError: 'http_5xx',
			lastResponseBody: 'boom',
			deliveredAt: null
		});
	});

	it('a redirect is a failure (never followed)', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		const { fn } = stubFetch(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test' } }));
		await deliverFresh({ db, config, now: NOW });
		expect(fn.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ lastStatus: 302, lastError: 'http_3xx', status: 'pending' });
	});

	it('network failures are classified', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		stubFetch(() => {
			throw new DOMException('The operation timed out', 'TimeoutError');
		});
		await deliverFresh({ db, config, now: NOW });
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ lastStatus: null, lastError: 'timeout', lastResponseBody: null });

		expect(classifyFetchError(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe('dns');
		expect(classifyFetchError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))).toBe('connection_refused');
		expect(classifyFetchError(new TypeError('fetch failed', { cause: { code: 'CERT_HAS_EXPIRED' } }))).toBe('tls');
		expect(classifyFetchError(new Error('Network connection lost.'))).toBe('connection_reset');
		expect(classifyFetchError(new Error('???'))).toBe('network');
	});

	it('keeps at most 2 KB of the response body', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		stubFetch(() => new Response('я'.repeat(5000), { status: 500 }));
		await deliverFresh({ db, config, now: NOW });
		const d = await deliveryOf(db, e.deliveryId);
		expect(new TextEncoder().encode(d.lastResponseBody!).byteLength).toBeLessThanOrEqual(2048);
		expect(d.lastResponseBody).toBe('я'.repeat(1024));
		expect((await attemptsOf(db, e.deliveryId))[0]!.responseBody).toBe(d.lastResponseBody);
	});
});

describe('backoff', () => {
	it('1m, 5m, 30m, 2h, 6h, 12h, 24h, then every 24h', () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(retryDelayMs)).toEqual([
			MIN,
			5 * MIN,
			30 * MIN,
			2 * HOUR,
			6 * HOUR,
			12 * HOUR,
			24 * HOUR,
			24 * HOUR,
			24 * HOUR
		]);
	});

	it('gives up when the next attempt would fall past 3 days after the event', () => {
		expect(nextAttemptAfterFailure(NOW, 7, NOW + 40 * HOUR)).toBe(NOW + 64 * HOUR);
		expect(nextAttemptAfterFailure(NOW, 8, NOW + 48 * HOUR)).toBe(NOW + RETRY_WINDOW_MS);
		expect(nextAttemptAfterFailure(NOW, 8, NOW + 48 * HOUR + 1)).toBeNull();
		expect(nextAttemptAfterFailure(NOW, 1, NOW + RETRY_WINDOW_MS)).toBeNull();
	});

	it('the cron walks the whole schedule and then fails the delivery', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		const { fn } = stubFetch(() => new Response('down', { status: 500 }));

		let now = NOW + INLINE_DELIVERY_GRACE_MS;
		const times: number[] = [];
		for (let i = 0; i < 20; i++) {
			expect(await deliverDue(db, config, now)).toBe(1);
			times.push(now);
			const d = await deliveryOf(db, e.deliveryId);
			if (d.status === 'failed') break;
			// Nothing is due before the scheduled time.
			expect(await deliverDue(db, config, d.nextAttemptAt! - 1)).toBe(0);
			now = d.nextAttemptAt!;
		}
		const d = await deliveryOf(db, e.deliveryId);
		expect(d).toMatchObject({ status: 'failed', nextAttemptAt: null, lastError: 'http_5xx' });
		const gaps = times.slice(1).map((t, i) => t - times[i]!);
		expect(gaps).toEqual([MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 24 * HOUR]);
		expect(times[times.length - 1]! - NOW).toBeLessThanOrEqual(RETRY_WINDOW_MS);
		expect(d.attempts).toBe(9);
		expect(fn).toHaveBeenCalledTimes(9);
		expect((await attemptsOf(db, e.deliveryId)).map((a) => a.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(await deliverDue(db, config, now + 10 * 24 * HOUR)).toBe(0);
	});
});

describe('claiming', () => {
	let release: () => void;
	let gate: Promise<void>;
	beforeEach(() => {
		gate = new Promise((r) => (release = r));
	});

	it('concurrent crons never send the same delivery twice', async () => {
		const { db, emit } = await setup();
		for (let i = 0; i < 3; i++) await emit(i);
		const { fn } = stubFetch(async () => {
			await gate;
			return new Response('ok');
		});
		const due = NOW + INLINE_DELIVERY_GRACE_MS;
		const runs = Promise.all([deliverDue(db, config, due), deliverDue(db, config, due), deliverDue(db, config, due)]);
		await new Promise((r) => setTimeout(r, 20));
		release();
		const counts = await runs;
		expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
		expect(fn).toHaveBeenCalledTimes(3);
		expect(await db.select().from(deliveryAttempt)).toHaveLength(3);
		expect((await db.select().from(delivery)).every((d) => d.status === 'succeeded' && d.attempts === 1)).toBe(true);
	});

	it('deliverFresh and the cron never both send', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		const { fn } = stubFetch(async () => {
			await gate;
			return new Response('ok');
		});
		const at = NOW + INLINE_DELIVERY_GRACE_MS; // due for the cron and still fresh
		const runs = Promise.all([deliverFresh({ db, config, now: at }), deliverDue(db, config, at), deliverFresh({ db, config, now: at })]);
		await new Promise((r) => setTimeout(r, 20));
		release();
		await runs;
		expect(fn).toHaveBeenCalledTimes(1);
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ status: 'succeeded', attempts: 1 });
	});

	it('an in-flight claim hides the delivery until its lease ends', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		// Simulate an isolate that claimed and died: attempts bumped, lease set.
		await db
			.update(delivery)
			.set({ attempts: 1, nextAttemptAt: NOW + CLAIM_LEASE_MS })
			.where(eq(delivery.id, e.deliveryId));
		const { fn } = stubFetch();
		expect(await deliverFresh({ db, config, now: NOW + 1000 })).toBe(0);
		expect(await deliverDue(db, config, NOW + CLAIM_LEASE_MS - 1)).toBe(0);
		expect(await deliverDue(db, config, NOW + CLAIM_LEASE_MS)).toBe(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ status: 'succeeded', attempts: 2 });
	});

	it('deliverFresh only takes never-attempted deliveries from the last 2 minutes', async () => {
		const { db, emit } = await setup();
		const old = await emit(1, NOW - 3 * MIN);
		const fresh = await emit(2, NOW - MIN);
		const { fn } = stubFetch();
		expect(await deliverFresh({ db, config, now: NOW })).toBe(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect((await deliveryOf(db, old.deliveryId)).status).toBe('pending');
		expect((await deliveryOf(db, fresh.deliveryId)).status).toBe('succeeded');
		expect(await deliverFresh({ db, config, now: NOW })).toBe(0);
	});

	it('handles at most 10 fresh deliveries per request', async () => {
		const { db, emit } = await setup();
		for (let i = 0; i < 12; i++) await emit(i);
		const { fn } = stubFetch();
		expect(await deliverFresh({ db, config, now: NOW })).toBe(10);
		expect(fn).toHaveBeenCalledTimes(10);
	});
});

describe('projects that cannot receive', () => {
	it('no webhook URL: settled as failed at once, nothing sent', async () => {
		const { db, emit } = await setup({ webhookUrl: null });
		const e = await emit();
		const { fn } = stubFetch();
		expect(await deliverFresh({ db, config, now: NOW })).toBe(1);
		expect(fn).not.toHaveBeenCalled();
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({
			status: 'failed',
			attempts: 0,
			nextAttemptAt: null,
			lastError: 'no_webhook_url'
		});
		expect(await attemptsOf(db, e.deliveryId)).toHaveLength(0);
	});

	it('the cron settles them too', async () => {
		const { db, emit } = await setup({ webhookUrl: null });
		const e = await emit(0, NOW - 10 * MIN);
		stubFetch();
		expect(await deliverDue(db, config, NOW)).toBe(1);
		expect((await deliveryOf(db, e.deliveryId)).lastError).toBe('no_webhook_url');
	});

	it('an archived project: failed with project_archived', async () => {
		const { db, emit, project: p } = await setup();
		const e = await emit();
		await db.update(project).set({ archivedAt: NOW }).where(eq(project.id, p.id));
		const { fn } = stubFetch();
		await deliverFresh({ db, config, now: NOW });
		expect(fn).not.toHaveBeenCalled();
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ status: 'failed', lastError: 'project_archived' });
	});
});

describe('redeliver', () => {
	it('re-sends a failed delivery now and keeps the attempt history', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		stubFetch(() => new Response('no', { status: 500 }));
		await deliverFresh({ db, config, now: NOW });
		// Past the 3-day window, the next failure gives up.
		await db.update(delivery).set({ status: 'failed', nextAttemptAt: null }).where(eq(delivery.id, e.deliveryId));

		const { fn } = stubFetch(() => new Response('ok'));
		const result = await redeliver({ db, config, now: NOW + 4 * 24 * HOUR }, e.id);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ deliveryId: e.deliveryId, status: 'succeeded', attempts: 2, httpStatus: 200, error: null });
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ status: 'succeeded', attempts: 2, nextAttemptAt: null });
		expect((await attemptsOf(db, e.deliveryId)).map((a) => [a.number, a.trigger, a.succeeded])).toEqual([
			[1, 'inline', false],
			[2, 'manual', true]
		]);
	});

	it('a failed re-delivery inside the window resumes the schedule; outside it fails again', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		stubFetch(() => new Response('no', { status: 500 }));
		expect(await redeliver({ db, config, now: NOW + HOUR }, e.id)).toMatchObject({
			status: 'pending',
			attempts: 1,
			nextAttemptAt: NOW + HOUR + MIN
		});
		expect(await redeliver({ db, config, now: NOW + RETRY_WINDOW_MS }, e.id)).toMatchObject({
			status: 'failed',
			attempts: 2,
			nextAttemptAt: null
		});
	});

	it('also re-sends a delivery that already succeeded', async () => {
		const { db, emit } = await setup();
		const e = await emit();
		const { fn } = stubFetch();
		await deliverFresh({ db, config, now: NOW });
		await redeliver({ db, config, now: NOW + MIN }, e.id);
		expect(fn).toHaveBeenCalledTimes(2);
		expect(await deliveryOf(db, e.deliveryId)).toMatchObject({ status: 'succeeded', attempts: 2, deliveredAt: NOW + MIN });
	});

	it('without a webhook URL it settles as failed, and 404s for an unknown event', async () => {
		const { db, emit } = await setup({ webhookUrl: null });
		const e = await emit();
		const { fn } = stubFetch();
		expect(await redeliver({ db, config, now: NOW }, e.id)).toMatchObject({ status: 'failed', error: 'no_webhook_url' });
		expect(fn).not.toHaveBeenCalled();
		const err = await redeliver({ db, config, now: NOW }, '01K00000000000000000000000').catch((x: unknown) => x);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({ status: 404 });
	});
});

it('truncateResponseBody keeps at most 2 KB without splitting a character', () => {
	expect(truncateResponseBody('ok')).toBe('ok');
	const long = 'я'.repeat(2000); // 2 bytes each
	const cut = truncateResponseBody(long);
	expect(new TextEncoder().encode(cut).byteLength).toBeLessThanOrEqual(2048);
	expect(cut).toBe('я'.repeat(1024));
	expect(truncateResponseBody('ab' + 'я'.repeat(2000)).endsWith('я')).toBe(true);
});

it('BOGTS_VERSION matches the gateway package version', () => {
	const pkg = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as { version: string };
	expect(BOGTS_VERSION).toBe(pkg.version);
});
