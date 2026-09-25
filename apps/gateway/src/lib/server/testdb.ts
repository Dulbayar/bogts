/**
 * A real SQLite database for tests, not a mock.
 *
 * The gateway's invariants are enforced by SQL: the ledger's unique
 * `(provider, provider_ref)`, conditional updates, `INSERT … ON CONFLICT`. A
 * hand-written fake would agree with whatever the code believes, so tests run
 * the generated Drizzle migrations against an in-memory SQLite database and
 * exercise the same statements production sends to D1.
 *
 * Two fidelity choices:
 *  - `foreign_keys = ON`, because D1 enforces them.
 *  - `db.batch()` is shimmed onto the better-sqlite3 driver (which only has
 *    `transaction()`), so batched statements run in one real SQLite
 *    transaction, as D1 runs them.
 *
 * Test scaffolding only: nothing in `src/routes` may import this file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { issueApiKey } from './auth/api-key';
import { encrypt } from './crypto';
import type { DB } from './db';
import type { Config } from './env';
import { newId, newWebhookSecret } from './ids';
import * as schema from './schema';
import { plan, project, type PlanInterval, type Project } from './schema';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

/** Drizzle emits one file per migration, split internally by breakpoints. */
function migrationStatements(): string[] {
	return readdirSync(MIGRATIONS_DIR)
		.filter((f) => f.endsWith('.sql'))
		.sort()
		.flatMap((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').split('--> statement-breakpoint'))
		.map((s) => s.trim())
		.filter(Boolean);
}

type Preparable = { _prepare(): { executeMethod: 'run' | 'all' | 'get' | 'values' } };

/**
 * Drizzle's better-sqlite3 driver has no `batch()`. Give it D1's contract: run
 * every statement in order inside one transaction, roll back on error, return
 * one result per statement.
 */
function attachBatch(db: ReturnType<typeof drizzle>, sqlite: Database.Database) {
	const inTransaction = sqlite.transaction((statements: Preparable[]) =>
		statements.map((statement) => {
			const prepared = statement._prepare() as unknown as Record<string, () => unknown> & {
				executeMethod: 'run' | 'all' | 'get' | 'values';
			};
			return prepared[prepared.executeMethod]!();
		})
	);
	(db as unknown as { batch: (s: unknown[]) => Promise<unknown[]> }).batch = async (statements) =>
		inTransaction(statements as Preparable[]);
}

export type TestDb = DB & { $sqlite: Database.Database };

/**
 * A migrated, empty database.
 *
 * The cast to `DB` is the one lie here: D1 and better-sqlite3 differ at the
 * type level (async vs sync result kinds), but every builder Drizzle returns is
 * thenable either way and `attachBatch` supplies the one missing method.
 */
export function createTestDb(): TestDb {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	for (const statement of migrationStatements()) sqlite.exec(statement);
	const db = drizzle(sqlite, { schema });
	attachBatch(db, sqlite);
	const typed = db as unknown as TestDb;
	Object.defineProperty(typed, '$sqlite', { value: sqlite, enumerable: false });
	return typed;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A valid ENCRYPTION_KEY (32 bytes of 0x01, base64). Tests only. */
export const TEST_ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
export const TEST_ADMIN_PASSWORD = 'correct horse battery staple';

/** A valid `Config` (password mode, both providers on, sandbox URLs), with overrides. */
export function testConfig(overrides: Partial<Config> = {}): Config {
	return {
		publicOrigin: 'https://payments.test',
		encryptionKey: TEST_ENCRYPTION_KEY,
		admin: { mode: 'password', password: TEST_ADMIN_PASSWORD },
		bonum: {
			environment: 'test',
			baseUrl: 'https://testapi.bonum.mn',
			appSecret: 'test-app-secret',
			terminalId: 'test-terminal',
			checksumKey: 'test-checksum-key'
		},
		qpay: {
			environment: 'test',
			baseUrl: 'https://merchant-sandbox.qpay.mn',
			clientId: 'TEST_CLIENT',
			clientPassword: 'test-password',
			invoiceCode: 'TEST_INVOICE'
		},
		providers: { bonum: true, qpay: true },
		warnings: [],
		...overrides
	};
}

export type SeededProject = { project: Project; apiKey: string; webhookSecret: string };

/** A project with a known API key and webhook secret. */
export async function seedProject(
	db: DB,
	opts: { name?: string; slug?: string; webhookUrl?: string | null; archived?: boolean; now?: number } = {}
): Promise<SeededProject> {
	const now = opts.now ?? Date.now();
	const id = newId();
	const { key, hash, prefix } = await issueApiKey();
	const webhookSecret = newWebhookSecret();
	const [row] = await db
		.insert(project)
		.values({
			id,
			name: opts.name ?? 'Test project',
			slug: opts.slug ?? `test-${id.toLowerCase()}`,
			apiKeyHash: hash,
			apiKeyPrefix: prefix,
			webhookUrl: opts.webhookUrl === undefined ? 'https://project.test/webhooks/bogts' : opts.webhookUrl,
			webhookSecretEnc: await encrypt(webhookSecret, TEST_ENCRYPTION_KEY),
			createdAt: now,
			updatedAt: now,
			archivedAt: opts.archived ? now : null
		})
		.returning();
	return { project: row!, apiKey: key, webhookSecret };
}

/** A Bonum plan on a project. */
export async function seedPlan(
	db: DB,
	projectId: string,
	opts: { key?: string; providerPlanId?: number; amount?: number; interval?: PlanInterval; now?: number } = {}
) {
	const now = opts.now ?? Date.now();
	const [row] = await db
		.insert(plan)
		.values({
			id: newId(),
			projectId,
			key: opts.key ?? 'pro-monthly',
			name: 'Pro (monthly)',
			providerPlanId: opts.providerPlanId ?? 166,
			amount: opts.amount ?? 49_900,
			interval: opts.interval ?? 'monthly',
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return row!;
}

/* ------------------------------------------------------------------ *
 * Query accounting (perf tests)
 * ------------------------------------------------------------------ */

export type QueryStats = {
	/** SQL statements executed */
	statements: number;
	/** What D1 would bill as round trips: each statement outside a batch, plus one per `db.batch` */
	roundTrips: number;
	reset(): void;
};

/**
 * Counts the statements and D1 round trips `db` runs from now on. Wraps the
 * SQLite handle's `prepare` (Drizzle prepares once per execution) and the
 * `batch` shim.
 */
export function countQueries(db: TestDb): QueryStats {
	const stats: QueryStats = {
		statements: 0,
		roundTrips: 0,
		reset() {
			stats.statements = 0;
			stats.roundTrips = 0;
		}
	};
	const sqlite = db.$sqlite;
	const prepare = sqlite.prepare.bind(sqlite);
	let inBatch = 0;
	sqlite.prepare = ((source: string) => {
		stats.statements++;
		if (!inBatch) stats.roundTrips++;
		return prepare(source);
	}) as typeof sqlite.prepare;
	const holder = db as unknown as { batch: (s: unknown[]) => Promise<unknown[]> };
	const batch = holder.batch;
	holder.batch = async (statements) => {
		stats.roundTrips++;
		inBatch++;
		try {
			return await batch(statements);
		} finally {
			inBatch--;
		}
	};
	return stats;
}
