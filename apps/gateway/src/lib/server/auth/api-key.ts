/**
 * Project API keys: `Authorization: Bearer bgk_<32 base62>`.
 *
 * Only the key's sha256 is stored (`project.api_key_hash`, unique), so a
 * lookup by hash is the comparison: there is no stored secret to compare in
 * constant time, and a database leak does not leak usable keys. The keys are
 * random (~190 bits), so an unsalted hash is enough.
 */
import { and, eq, gt, or } from 'drizzle-orm';
import { ApiError } from '../api/errors';
import { sha256Hex } from '../crypto';
import type { DB } from '../db';
import { API_KEY_PATTERN, apiKeyDisplayPrefix, newApiKey } from '../ids';
import { project, type Project } from '../schema';

export const hashApiKey = (key: string): Promise<string> => sha256Hex(key);

/** A fresh key and what to store for it. Show `key` to the operator once. */
export async function issueApiKey(): Promise<{ key: string; hash: string; prefix: string }> {
	const key = newApiKey();
	return { key, hash: await hashApiKey(key), prefix: apiKeyDisplayPrefix(key) };
}

const unauthorized = (message: string) =>
	new ApiError(401, 'unauthorized', message, { 'www-authenticate': 'Bearer realm="bogts"' });

/** The key from `Authorization: Bearer …`, or null when the header is absent or malformed. */
export function bearerKey(request: Request): string | null {
	const header = request.headers.get('authorization');
	if (!header) return null;
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
	return match?.[1] ?? null;
}

/** How long the old key keeps working after a rotation. */
export const API_KEY_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves the request's project, or throws a 401 `ApiError`. Accepts the
 * current key, or the previous one for 24 h after a rotation. Archived
 * projects are refused. Never logs the key.
 */
export async function authenticateProject(request: Request, db: DB, now = Date.now()): Promise<Project> {
	const key = bearerKey(request);
	if (!key) throw unauthorized('Missing API key: send Authorization: Bearer bgk_…');
	if (!API_KEY_PATTERN.test(key)) throw unauthorized('Invalid API key');
	const hash = await hashApiKey(key);
	const row = await db.query.project.findFirst({
		where: or(
			eq(project.apiKeyHash, hash),
			and(eq(project.previousApiKeyHash, hash), gt(project.previousApiKeyExpiresAt, now))
		)
	});
	if (!row || row.archivedAt !== null) throw unauthorized('Invalid API key');
	return row;
}

/**
 * Issues a new key for a project. The current key becomes the previous one and
 * keeps working for 24 h (a key that was already "previous" stops at once).
 * Returns the new key in plain text: show it once, it is not stored.
 */
export async function rotateApiKey(
	db: DB,
	projectId: string,
	now = Date.now()
): Promise<{ key: string; prefix: string; previousExpiresAt: number }> {
	const current = await db.query.project.findFirst({ where: eq(project.id, projectId) });
	if (!current) throw new ApiError(404, 'not_found', 'Project not found');
	const next = await issueApiKey();
	const previousExpiresAt = now + API_KEY_ROTATION_OVERLAP_MS;
	// Conditional on the hash we read, so two concurrent rotations cannot both win
	// and silently drop a key someone was just shown.
	const updated = await db
		.update(project)
		.set({
			apiKeyHash: next.hash,
			apiKeyPrefix: next.prefix,
			previousApiKeyHash: current.apiKeyHash,
			previousApiKeyExpiresAt: previousExpiresAt,
			previousApiKeyPrefix: current.apiKeyPrefix,
			updatedAt: now
		})
		.where(and(eq(project.id, projectId), eq(project.apiKeyHash, current.apiKeyHash)))
		.returning({ id: project.id });
	if (updated.length === 0) throw new ApiError(409, 'conflict', 'The key was rotated at the same time; try again');
	return { key: next.key, prefix: next.prefix, previousExpiresAt };
}
