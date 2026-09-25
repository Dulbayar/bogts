/**
 * `Idempotency-Key` for project POSTs (docs/contracts.md): stored per project
 * for 24 h; a repeat request returns the first response.
 *
 * - Same key, same request (method + path + body), first one finished: the
 *   stored response is replayed with `Idempotent-Replayed: true`.
 * - Same key, different request: 422 `idempotency_key_reused`.
 * - Same key while the first is still running: 409 `idempotency_in_progress`.
 * - The first threw a 4xx `ApiError` (nothing happened) or answered 5xx: the
 *   key is released so a retry can run.
 * - The first threw anything else (a 5xx `ApiError`, an unexpected error): the
 *   work may have half-happened (a card charged, then D1 failed), so the error
 *   response is stored and replayed instead of running again.
 *
 * The claim is one `INSERT … ON CONFLICT DO NOTHING`, so two concurrent
 * requests cannot both run.
 */
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { ApiError, errorResponse } from './api/errors';
import { sha256Hex } from './crypto';
import type { DB } from './db';
import { idempotency } from './schema';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A claim older than this with no response is treated as abandoned (the isolate died). */
export const IDEMPOTENCY_STALE_MS = 60 * 1000;

const KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/** The request's `Idempotency-Key`, or null. Throws 400 on a malformed key. */
export function idempotencyKey(request: Request): string | null {
	const key = request.headers.get(IDEMPOTENCY_HEADER);
	if (key === null) return null;
	if (!KEY_PATTERN.test(key)) {
		throw new ApiError(400, 'invalid_request', 'Idempotency-Key must be 1-255 printable ASCII characters');
	}
	return key;
}

export interface IdempotentInput {
	projectId: string;
	/** From `idempotencyKey(request)`; null runs `run` without any of this */
	key: string | null;
	method: string;
	/** The URL path (no origin) */
	path: string;
	/** The exact body text the handler parsed */
	body: string;
	now?: number;
}

function replay(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			'idempotent-replayed': 'true'
		}
	});
}

/**
 * Runs `run` at most once per (project, key) within 24 h. `run` must return a
 * JSON response (use `json()`); its status and body are stored.
 */
export async function idempotent(db: DB, input: IdempotentInput, run: () => Promise<Response>): Promise<Response> {
	if (input.key === null) return run();
	const now = input.now ?? Date.now();
	const requestHash = await sha256Hex(`${input.method.toUpperCase()}\n${input.path}\n${input.body}`);
	const where = and(eq(idempotency.projectId, input.projectId), eq(idempotency.key, input.key));

	const claim = () =>
		db
			.insert(idempotency)
			.values({ projectId: input.projectId, key: input.key!, requestHash, createdAt: now })
			.onConflictDoNothing()
			.returning({ key: idempotency.key });

	let claimed = (await claim()).length > 0;
	if (!claimed) {
		const existing = await db.query.idempotency.findFirst({ where });
		const expired = existing && existing.createdAt <= now - IDEMPOTENCY_TTL_MS;
		const abandoned = existing && existing.status === null && existing.createdAt <= now - IDEMPOTENCY_STALE_MS;
		if (!existing || expired || abandoned) {
			// Delete exactly the row we looked at, then race for a fresh claim.
			if (existing) {
				await db.delete(idempotency).where(and(where, eq(idempotency.createdAt, existing.createdAt)));
			}
			claimed = (await claim()).length > 0;
		} else if (existing.requestHash !== requestHash) {
			throw new ApiError(422, 'idempotency_key_reused', 'This Idempotency-Key was used with a different request');
		} else if (existing.status === null || existing.response === null) {
			throw new ApiError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running');
		} else {
			return replay(existing.status, existing.response);
		}
		if (!claimed) {
			throw new ApiError(409, 'idempotency_in_progress', 'A request with this Idempotency-Key is still running');
		}
	}

	let response: Response;
	try {
		response = await run();
	} catch (err) {
		// A 4xx ApiError (or zod error) did nothing: release. Anything else is
		// stored; an unexpected error becomes 500 internal_error, logged by name only.
		if (err instanceof ApiError ? err.status < 500 : err instanceof z.ZodError) {
			await db.delete(idempotency).where(where);
			throw err;
		}
		const failed = errorResponse(err);
		await db
			.update(idempotency)
			.set({ status: failed.status, response: await failed.clone().text() })
			.where(where);
		return failed;
	}
	if (response.status >= 500) {
		await db.delete(idempotency).where(where);
		return response;
	}
	const body = await response.clone().text();
	await db.update(idempotency).set({ status: response.status, response: body }).where(where);
	return response;
}

/** Drops keys older than 24 h; run from the cron. */
export async function purgeIdempotency(db: DB, now: number): Promise<void> {
	await db.delete(idempotency).where(lt(idempotency.createdAt, now - IDEMPOTENCY_TTL_MS));
}
