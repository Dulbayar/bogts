/**
 * Event delivery: signs and POSTs each pending `delivery` to its project's
 * webhook URL, retries with backoff for up to 3 days, and records every
 * attempt (`delivery_attempt`) and the latest result (`delivery.last_*`).
 *
 * The request:
 *   POST <project.webhookUrl>
 *   Content-Type: application/json
 *   User-Agent: Bogts/<version>
 *   Bogts-Event-Id: <event id>
 *   Bogts-Event-Type: <event type>
 *   Bogts-Signature: t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<raw body>")>
 *   body: JSON.stringify(eventJson(event))  (the public event shape)
 *
 * Who runs it:
 *  - `deliverFresh(ctx)`: after every /v1 and /hooks response (hooks.server.ts,
 *    via waitUntil), for deliveries emitted in the last 2 minutes that were
 *    never attempted. It ignores the inline grace (`next_attempt_at`).
 *  - `deliverDue(db, config, now)`: the every-minute cron, for everything due.
 *  - `redeliver(ctx, eventId)`: the dashboard's Re-deliver.
 *
 * Claiming: a delivery is claimed by one conditional UPDATE that increments
 * `attempts` and pushes `next_attempt_at` out by a lease (`CLAIM_LEASE_MS`).
 * The cron only takes rows with `next_attempt_at <= now` and `deliverFresh`
 * only rows with `attempts = 0`, so a claimed row is invisible to both until
 * the lease ends (which only matters if the isolate died mid-attempt: the
 * cron then retries it). D1 runs each statement atomically, so two concurrent
 * claimers never both win. The result is written conditionally on the claimed
 * `attempts`, so a stale attempt never overwrites a newer one.
 *
 * Delivery is at least once: projects dedupe by `event.id`.
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { ApiError } from '../api/errors';
import { decrypt, hmacSha256Hex } from '../crypto';
import type { DB } from '../db';
import type { Config } from '../env';
import { newId } from '../ids';
import {
	delivery,
	deliveryAttempt,
	event,
	project,
	type Delivery,
	type DeliveryAttemptTrigger,
	type DeliveryStatus,
	type EventRow,
	type Project
} from '../schema';
import { nowOf, type ServiceContext } from '../services/context';
import { eventJson } from './public';

/** Keep in step with apps/gateway/package.json (a test checks). */
export const BOGTS_VERSION = '0.0.0';
export const USER_AGENT = `Bogts/${BOGTS_VERSION}`;

export const SIGNATURE_HEADER = 'Bogts-Signature';
export const EVENT_ID_HEADER = 'Bogts-Event-Id';
export const EVENT_TYPE_HEADER = 'Bogts-Event-Type';

/** The whole attempt (connect, answer, reading the body) must finish in this. */
export const DELIVERY_TIMEOUT_MS = 10_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Wait after the n-th failed attempt (index n-1); every 24 h after the last. */
export const RETRY_DELAYS_MS = [MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR, 12 * HOUR, DAY] as const;
/** No attempt is scheduled later than this after the event; then the delivery fails. */
export const RETRY_WINDOW_MS = 3 * DAY;

/** How long a claimed delivery stays invisible to other claimers. Well over the timeout. */
export const CLAIM_LEASE_MS = 5 * MINUTE;
export const DUE_BATCH_SIZE = 50;
export const FRESH_WINDOW_MS = 2 * MINUTE;
export const FRESH_BATCH_SIZE = 10;
export const DELIVERY_CONCURRENCY = 5;

/** `delivery.last_response_body` keeps at most this many bytes of the project's answer. */
export const RESPONSE_BODY_MAX_BYTES = 2048;
/** Read at most this much of the answer off the wire before truncating. */
const RESPONSE_READ_MAX_BYTES = 8 * 1024;

/** Truncates a response body to 2 KB of UTF-8 without splitting a character. */
export function truncateResponseBody(body: string, maxBytes = RESPONSE_BODY_MAX_BYTES): string {
	const bytes = new TextEncoder().encode(body);
	if (bytes.byteLength <= maxBytes) return body;
	// `fatal: false` drops a trailing partial character as U+FFFD; strip it.
	return new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/�$/, '');
}

/* ------------------------------------------------------------------ *
 * Signing and backoff
 * ------------------------------------------------------------------ */

/**
 * The `Bogts-Signature` header value: `t=<timestamp>,v1=<hex hmac>`, where the
 * HMAC-SHA256 is over `"<timestamp>.<body>"` under the UTF-8 bytes of `secret`.
 * `timestamp` is unix seconds.
 */
export async function signPayload(secret: string, timestamp: number, body: string): Promise<string> {
	const t = Math.floor(timestamp);
	return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${body}`)}`;
}

/** The wait after `attempts` failed attempts (1-based). */
export function retryDelayMs(attempts: number): number {
	const i = Math.max(1, attempts) - 1;
	return RETRY_DELAYS_MS[Math.min(i, RETRY_DELAYS_MS.length - 1)]!;
}

/**
 * When to try next after `attempts` failed attempts, or null to give up: the
 * next attempt would fall more than 3 days after the event.
 */
export function nextAttemptAfterFailure(eventCreatedAt: number, attempts: number, now: number): number | null {
	const next = now + retryDelayMs(attempts);
	return next > eventCreatedAt + RETRY_WINDOW_MS ? null : next;
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

export interface AttemptOutcome {
	ok: boolean;
	/** The project's HTTP status, when it answered */
	httpStatus: number | null;
	/** Null on success; otherwise a short class (`timeout`, `dns`, `tls`, `http_5xx`, …) */
	error: string | null;
	/** Truncated to 2 KB; null when empty or never received */
	responseBody: string | null;
	durationMs: number;
}

export const httpErrorClass = (status: number) => `http_${Math.floor(status / 100)}xx`;

/** A short, safe class for a fetch failure. Never the raw message. */
export function classifyFetchError(err: unknown): string {
	const e = err as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } };
	if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
	const text = [e?.message, e?.code, e?.cause?.code, e?.cause?.message].filter((v) => typeof v === 'string').join(' ');
	if (/ENOTFOUND|EAI_AGAIN|\bdns\b|name resolution|resolve host/i.test(text)) return 'dns';
	if (/CERT|SSL|TLS|certificate|handshake/i.test(text)) return 'tls';
	if (/ETIMEDOUT|CONNECT_TIMEOUT|timed? ?out/i.test(text)) return 'timeout';
	if (/ECONNREFUSED|refused/i.test(text)) return 'connection_refused';
	if (/ECONNRESET|EPIPE|reset|connection lost|socket hang up|other side closed/i.test(text)) return 'connection_reset';
	if (/invalid url|Invalid URL|ERR_INVALID_URL/i.test(text)) return 'invalid_url';
	return 'network';
}

/** Reads at most `maxBytes` of a body as text. Swallows read errors (keeps what arrived). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (size < maxBytes) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.byteLength;
		}
	} catch {
		// Timeout or reset while reading: keep what we have.
	} finally {
		reader.cancel().catch(() => {});
	}
	const all = new Uint8Array(Math.min(size, maxBytes));
	let offset = 0;
	for (const c of chunks) {
		const part = c.subarray(0, all.byteLength - offset);
		all.set(part, offset);
		offset += part.byteLength;
		if (offset >= all.byteLength) break;
	}
	return new TextDecoder().decode(all);
}

/** One POST with the 10 s timeout. Never throws. */
export async function postWebhook(url: string, body: string, headers: Record<string, string>): Promise<AttemptOutcome> {
	const start = Date.now();
	const done = (o: Omit<AttemptOutcome, 'durationMs'>): AttemptOutcome => ({ ...o, durationMs: Date.now() - start });
	try {
		new URL(url);
	} catch {
		return done({ ok: false, httpStatus: null, error: 'invalid_url', responseBody: null });
	}
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new DOMException('Delivery timed out', 'TimeoutError')),
		DELIVERY_TIMEOUT_MS
	);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body,
			// A redirect is a failure: the project should fix its URL, and we never
			// resend a signed body somewhere it did not configure.
			redirect: 'manual',
			signal: controller.signal
		});
		const text = truncateResponseBody(await readCapped(res, RESPONSE_READ_MAX_BYTES));
		const ok = res.status >= 200 && res.status < 300;
		return done({ ok, httpStatus: res.status, error: ok ? null : httpErrorClass(res.status), responseBody: text || null });
	} catch (err) {
		const error = controller.signal.aborted ? 'timeout' : classifyFetchError(err);
		return done({ ok: false, httpStatus: null, error, responseBody: null });
	} finally {
		clearTimeout(timer);
	}
}

/* ------------------------------------------------------------------ *
 * Claiming and recording
 * ------------------------------------------------------------------ */

/** What happened to one delivery in a run. */
export interface DeliveryResult {
	deliveryId: string;
	eventId: string;
	status: DeliveryStatus;
	attempts: number;
	/** Null when no request was made */
	httpStatus: number | null;
	/** Null on success; `no_webhook_url`, `project_archived`, `timeout`, `http_5xx`, … */
	error: string | null;
	nextAttemptAt: number | null;
}

type Candidate = { id: string; webhookUrl: string | null; archivedAt: number | null };

const unsendableReason = (p: Pick<Project, 'webhookUrl' | 'archivedAt'>): 'project_archived' | 'no_webhook_url' | null =>
	p.archivedAt !== null ? 'project_archived' : !p.webhookUrl ? 'no_webhook_url' : null;

/**
 * Settles pending deliveries that cannot be sent (archived project, no URL) as
 * failed, without an attempt. The dashboard can re-deliver once fixed.
 */
async function settleUnsendable(db: DB, candidates: Candidate[], now: number): Promise<number> {
	const byReason = new Map<string, string[]>();
	for (const c of candidates) {
		const reason = unsendableReason(c);
		if (reason) byReason.set(reason, [...(byReason.get(reason) ?? []), c.id]);
	}
	let settled = 0;
	for (const [reason, ids] of byReason) {
		const rows = await db
			.update(delivery)
			.set({ status: 'failed', nextAttemptAt: null, lastError: reason, updatedAt: now })
			.where(and(inArray(delivery.id, ids), eq(delivery.status, 'pending')))
			.returning({ id: delivery.id });
		settled += rows.length;
	}
	return settled;
}

const claimSet = (now: number) => ({
	attempts: sql`${delivery.attempts} + 1`,
	nextAttemptAt: now + CLAIM_LEASE_MS,
	updatedAt: now
});

async function recordOutcome(
	db: DB,
	d: Delivery,
	ev: EventRow,
	url: string,
	signature: string | null,
	outcome: AttemptOutcome,
	trigger: DeliveryAttemptTrigger,
	now: number
): Promise<DeliveryResult> {
	const next = outcome.ok ? null : nextAttemptAfterFailure(ev.createdAt, d.attempts, now);
	const status: DeliveryStatus = outcome.ok ? 'succeeded' : next === null ? 'failed' : 'pending';
	await db.batch([
		db.insert(deliveryAttempt).values({
			id: newId(),
			deliveryId: d.id,
			eventId: ev.id,
			projectId: d.projectId,
			number: d.attempts,
			trigger,
			url,
			succeeded: outcome.ok,
			httpStatus: outcome.httpStatus,
			error: outcome.error,
			signature,
			responseBody: outcome.responseBody,
			durationMs: outcome.durationMs,
			createdAt: now
		}),
		db
			.update(delivery)
			.set({
				status,
				nextAttemptAt: next,
				lastStatus: outcome.httpStatus,
				lastError: outcome.error,
				lastResponseBody: outcome.responseBody,
				lastDurationMs: outcome.durationMs,
				...(outcome.ok ? { deliveredAt: now } : {}),
				updatedAt: now
			})
			// Only if nobody claimed it again meanwhile (lease expiry, re-deliver).
			.where(and(eq(delivery.id, d.id), eq(delivery.attempts, d.attempts)))
	]);
	return {
		deliveryId: d.id,
		eventId: ev.id,
		status,
		attempts: d.attempts,
		httpStatus: outcome.httpStatus,
		error: outcome.error,
		nextAttemptAt: next
	};
}

/** Sends one claimed delivery and records it. Never throws. */
async function attemptClaimed(
	db: DB,
	config: Config,
	d: Delivery,
	ev: EventRow | undefined,
	p: Project | undefined,
	trigger: DeliveryAttemptTrigger,
	now: number
): Promise<DeliveryResult | null> {
	try {
		if (!ev || !p) return null; // foreign keys make this unreachable
		const reason = unsendableReason(p);
		if (reason) {
			// The project changed between the read and the claim: undo the claim's count.
			await db
				.update(delivery)
				.set({ status: 'failed', nextAttemptAt: null, lastError: reason, attempts: sql`${delivery.attempts} - 1`, updatedAt: now })
				.where(and(eq(delivery.id, d.id), eq(delivery.attempts, d.attempts)));
			return { deliveryId: d.id, eventId: ev.id, status: 'failed', attempts: d.attempts - 1, httpStatus: null, error: reason, nextAttemptAt: null };
		}
		const url = p.webhookUrl!;
		let secret: string;
		try {
			secret = await decrypt(p.webhookSecretEnc, config.encryptionKey);
		} catch {
			const outcome: AttemptOutcome = { ok: false, httpStatus: null, error: 'secret_unavailable', responseBody: null, durationMs: 0 };
			return await recordOutcome(db, d, ev, url, null, outcome, trigger, now);
		}
		const body = JSON.stringify(eventJson(ev));
		// The real clock, not `now`: receivers check it against theirs.
		const signature = await signPayload(secret, Math.floor(Date.now() / 1000), body);
		const outcome = await postWebhook(url, body, {
			'content-type': 'application/json',
			'user-agent': USER_AGENT,
			[SIGNATURE_HEADER]: signature,
			[EVENT_ID_HEADER]: ev.id,
			[EVENT_TYPE_HEADER]: ev.type
		});
		return await recordOutcome(db, d, ev, url, signature, outcome, trigger, now);
	} catch (err) {
		console.error('[deliver] attempt failed', err instanceof Error ? err.name : typeof err, d.id);
		return null;
	}
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]!);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/** Loads the events and projects of claimed deliveries and attempts each. */
async function attemptAll(
	db: DB,
	config: Config,
	claimed: Delivery[],
	trigger: DeliveryAttemptTrigger,
	now: number
): Promise<DeliveryResult[]> {
	if (claimed.length === 0) return [];
	const eventIds = [...new Set(claimed.map((d) => d.eventId))];
	const projectIds = [...new Set(claimed.map((d) => d.projectId))];
	const [events, projects] = await Promise.all([
		db.select().from(event).where(inArray(event.id, eventIds)),
		db.select().from(project).where(inArray(project.id, projectIds))
	]);
	const eventById = new Map(events.map((e) => [e.id, e]));
	const projectById = new Map(projects.map((p) => [p.id, p]));
	const results = await pool(claimed, DELIVERY_CONCURRENCY, (d) =>
		attemptClaimed(db, config, d, eventById.get(d.eventId), projectById.get(d.projectId), trigger, now)
	);
	return results.filter((r): r is DeliveryResult => r !== null);
}

const candidateColumns = { id: delivery.id, webhookUrl: project.webhookUrl, archivedAt: project.archivedAt };

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

/**
 * The cron: attempts up to 50 due deliveries (`status = 'pending'` and
 * `next_attempt_at <= now`), 5 at a time, and settles those that cannot be
 * sent. Returns how many deliveries it handled. Never rejects.
 */
export async function deliverDue(db: DB, config: Config, now: number): Promise<number> {
	try {
		const due = and(eq(delivery.status, 'pending'), lte(delivery.nextAttemptAt, now));
		const candidates = await db
			.select(candidateColumns)
			.from(delivery)
			.innerJoin(project, eq(project.id, delivery.projectId))
			.where(due)
			.orderBy(delivery.nextAttemptAt)
			.limit(DUE_BATCH_SIZE);
		if (candidates.length === 0) return 0;
		const settled = await settleUnsendable(db, candidates, now);
		const sendable = candidates.filter((c) => !unsendableReason(c)).map((c) => c.id);
		const claimed =
			sendable.length === 0
				? []
				: await db.update(delivery).set(claimSet(now)).where(and(inArray(delivery.id, sendable), due)).returning();
		const results = await attemptAll(db, config, claimed, 'cron', now);
		return settled + results.length;
	} catch (err) {
		console.error('[deliver] deliverDue failed', err instanceof Error ? err.name : typeof err);
		return 0;
	}
}

/**
 * The inline attempt: up to 10 deliveries created in the last 2 minutes and
 * never attempted, ignoring the inline grace. hooks.server.ts runs it via
 * `waitUntil` after every /v1 and /hooks response. One cheap read when there
 * is nothing to do. Returns how many it handled. Never rejects.
 */
export async function deliverFresh(ctx: ServiceContext): Promise<number> {
	const { db, config } = ctx;
	const now = nowOf(ctx);
	try {
		const fresh = and(
			eq(delivery.status, 'pending'),
			eq(delivery.attempts, 0),
			gte(delivery.createdAt, now - FRESH_WINDOW_MS)
		);
		const candidates = await db
			.select(candidateColumns)
			.from(delivery)
			.innerJoin(project, eq(project.id, delivery.projectId))
			.where(fresh)
			.orderBy(delivery.createdAt)
			.limit(FRESH_BATCH_SIZE);
		if (candidates.length === 0) return 0;
		const settled = await settleUnsendable(db, candidates, now);
		const sendable = candidates.filter((c) => !unsendableReason(c)).map((c) => c.id);
		const claimed =
			sendable.length === 0
				? []
				: await db.update(delivery).set(claimSet(now)).where(and(inArray(delivery.id, sendable), fresh)).returning();
		const results = await attemptAll(db, config, claimed, 'inline', now);
		return settled + results.length;
	} catch (err) {
		console.error('[deliver] deliverFresh failed', err instanceof Error ? err.name : typeof err);
		return 0;
	}
}

/**
 * Re-delivers an event now, outside the backoff schedule (the dashboard's
 * Re-deliver). Sets its delivery back to pending and attempts it once; the
 * attempt is appended to the history (`delivery_attempt`), earlier attempts are
 * kept, and `attempts` keeps counting. After a failure the normal schedule
 * resumes, unless the event is past its 3-day window (then it fails again).
 * A project without a webhook URL, or archived, settles as failed at once.
 *
 * Throws `ApiError` 404 for an unknown event and 409 when another attempt
 * claimed the delivery at the same moment.
 */
export async function redeliver(ctx: ServiceContext, eventId: string): Promise<DeliveryResult> {
	const { db, config } = ctx;
	const now = nowOf(ctx);
	const [row] = await db
		.select({ delivery, event, project })
		.from(delivery)
		.innerJoin(event, eq(event.id, delivery.eventId))
		.innerJoin(project, eq(project.id, delivery.projectId))
		.where(eq(delivery.eventId, eventId))
		.orderBy(desc(delivery.createdAt))
		.limit(1);
	if (!row) throw new ApiError(404, 'not_found', 'Event not found');
	const d = row.delivery;

	const reason = unsendableReason(row.project);
	if (reason) {
		await db
			.update(delivery)
			.set({ status: 'failed', nextAttemptAt: null, lastError: reason, updatedAt: now })
			.where(eq(delivery.id, d.id));
		return { deliveryId: d.id, eventId, status: 'failed', attempts: d.attempts, httpStatus: null, error: reason, nextAttemptAt: null };
	}

	const [claimed] = await db
		.update(delivery)
		.set({ status: 'pending', ...claimSet(now) })
		.where(and(eq(delivery.id, d.id), eq(delivery.attempts, d.attempts)))
		.returning();
	if (!claimed) throw new ApiError(409, 'conflict', 'This event is being delivered right now; try again in a moment');

	const result = await attemptClaimed(db, config, claimed, row.event, row.project, 'manual', now);
	if (!result) throw new ApiError(500, 'internal_error', 'The delivery could not be recorded');
	return result;
}
