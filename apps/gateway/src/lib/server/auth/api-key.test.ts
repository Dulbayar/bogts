import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { newApiKey } from '../ids';
import { project } from '../schema';
import { createTestDb, seedProject, type TestDb } from '../testdb';
import { API_KEY_ROTATION_OVERLAP_MS, authenticateProject, bearerKey, hashApiKey, rotateApiKey } from './api-key';

const req = (authorization?: string) =>
	new Request('https://payments.test/v1/invoices', { headers: authorization ? { authorization } : {} });

async function rejects401(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(ApiError);
	expect((err as ApiError).status).toBe(401);
	expect((err as ApiError).code).toBe('unauthorized');
	expect((err as ApiError).headers?.['www-authenticate']).toContain('Bearer');
}

describe('authenticateProject', () => {
	let db: TestDb;
	beforeEach(() => {
		db = createTestDb();
	});

	it('resolves the project from its key', async () => {
		const { project: p, apiKey } = await seedProject(db);
		const found = await authenticateProject(req(`Bearer ${apiKey}`), db);
		expect(found.id).toBe(p.id);
	});

	it('stores only the hash', async () => {
		const { project: p, apiKey } = await seedProject(db);
		expect(p.apiKeyHash).toBe(await hashApiKey(apiKey));
		expect(JSON.stringify(p)).not.toContain(apiKey);
		expect(p.apiKeyPrefix).toBe(apiKey.slice(0, 12));
	});

	it('refuses a missing, malformed or unknown key', async () => {
		await seedProject(db);
		await rejects401(authenticateProject(req(), db));
		await rejects401(authenticateProject(req('Basic abc'), db));
		await rejects401(authenticateProject(req('Bearer bgk_short'), db));
		await rejects401(authenticateProject(req(`Bearer ${newApiKey()}`), db));
	});

	it('refuses an archived project', async () => {
		const { apiKey } = await seedProject(db, { archived: true });
		await rejects401(authenticateProject(req(`Bearer ${apiKey}`), db));
	});

	it('parses the bearer header leniently on case and spacing', () => {
		expect(bearerKey(req('bearer   bgk_x '))).toBe('bgk_x');
		expect(bearerKey(req('Bearer a b'))).toBeNull();
	});
});

describe('rotateApiKey', () => {
	it('issues a new key; the old one works for 24 h, then stops', async () => {
		const db = createTestDb();
		const now = 1_800_000_000_000;
		const { project: p, apiKey: oldKey } = await seedProject(db, { now });
		const rotated = await rotateApiKey(db, p.id, now);
		expect(rotated.key).not.toBe(oldKey);
		expect(rotated.previousExpiresAt).toBe(now + API_KEY_ROTATION_OVERLAP_MS);
		const [stored] = await db.select().from(project).where(eq(project.id, p.id));
		expect(stored!.previousApiKeyPrefix).toBe(p.apiKeyPrefix);
		expect(stored!.apiKeyPrefix).toBe(rotated.prefix);

		expect((await authenticateProject(req(`Bearer ${rotated.key}`), db, now)).id).toBe(p.id);
		expect((await authenticateProject(req(`Bearer ${oldKey}`), db, now + API_KEY_ROTATION_OVERLAP_MS - 1)).id).toBe(p.id);
		await rejects401(authenticateProject(req(`Bearer ${oldKey}`), db, now + API_KEY_ROTATION_OVERLAP_MS));

		const row = await db.query.project.findFirst({ where: eq(project.id, p.id) });
		expect(row?.apiKeyPrefix).toBe(rotated.prefix);
	});

	it('a second rotation retires the first key immediately', async () => {
		const db = createTestDb();
		const now = 1_800_000_000_000;
		const { project: p, apiKey: first } = await seedProject(db, { now });
		const second = await rotateApiKey(db, p.id, now);
		const third = await rotateApiKey(db, p.id, now + 1);
		await rejects401(authenticateProject(req(`Bearer ${first}`), db, now + 2));
		expect((await authenticateProject(req(`Bearer ${second.key}`), db, now + 2)).id).toBe(p.id);
		expect((await authenticateProject(req(`Bearer ${third.key}`), db, now + 2)).id).toBe(p.id);
	});

	it('404s for an unknown project', async () => {
		const db = createTestDb();
		await expect(rotateApiKey(db, 'nope')).rejects.toMatchObject({ status: 404 });
	});
});
