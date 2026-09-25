/**
 * A real SQLite database for tests, not a mock, reached through the same
 * Drizzle driver production uses.
 *
 * The gateway's invariants are enforced by SQL: the ledger's unique
 * `(provider, provider_ref)`, conditional updates, `INSERT … ON CONFLICT`. A
 * hand-written fake would agree with whatever the code believes, so tests run
 * the generated Drizzle migrations against an in-memory SQLite database.
 *
 * The database is wrapped in a small `D1Database` (`FakeD1` below) and handed
 * to `drizzle-orm/d1`, the production driver, so result mapping is D1's too.
 * That matters: `db.batch()` gets D1's row OBJECTS back and Drizzle maps them
 * by position (`Object.keys(row)`), so a batched select with two columns of the
 * same name (`id`, `name`, `status`, …) silently shifts every later field. A
 * better-sqlite3 driver reads arrays and hides that. Fidelity choices:
 *  - `foreign_keys = ON`, because D1 enforces them.
 *  - `all()`/`first()`/`batch()` build objects the way workerd does
 *    (`Object.fromEntries` over the column names: a repeated name keeps its
 *    first position and the last value); `raw()` returns arrays.
 *  - `batch()` runs every statement in one SQLite transaction and returns one
 *    `all()`-shaped result per statement.
 *  - Bound booleans become 1/0, `undefined` is a type error, more than 100 bound
 *    parameters is an error (D1's limit), blobs come back as number arrays; `BEGIN`/`SAVEPOINT` are refused (D1 has no SQL transactions).
 *  - Stricter than D1: an object result with a repeated or integer-like column
 *    name throws (`strictColumns`), since that is data loss in production.
 *
 * Test scaffolding only: nothing in `src/routes` may import this file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { issueApiKey } from './auth/api-key';
import { encrypt } from './crypto';
import { getDb, type DB } from './db';
import type { Config } from './env';
import { newId, newWebhookSecret } from './ids';
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

/* ------------------------------------------------------------------ *
 * A D1Database over better-sqlite3
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Meta = D1Result['meta'];

/** D1 refuses SQL transaction control; so does the fake. */
const TRANSACTION_SQL = /^\s*(begin|commit|end|rollback|savepoint|release)\b/i;
const D1_MAX_PARAMS = 100;
/** Keys JavaScript orders first, whatever their position (array indices). */
const INDEX_LIKE = /^(0|[1-9]\d*)$/;

function toSqlite(value: unknown): unknown {
	if (value === undefined) throw new TypeError('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	return value;
}

function fromSqlite(value: unknown): unknown {
	if (value instanceof Uint8Array) return Array.from(value);
	if (typeof value === 'bigint') return Number(value);
	return value;
}

export type FakeD1Hooks = {
	/** Called once per SQL statement executed. */
	statement?: () => void;
	/** Called once per D1 round trip (a single statement, or a whole batch). */
	roundTrip?: () => void;
};

type Executed = { columns: string[]; rows: unknown[][]; changes: number; lastRowId: number };

class FakeD1Statement {
	constructor(
		private readonly d1: FakeD1,
		readonly sql: string,
		readonly params: unknown[] = []
	) {}

	bind(...values: unknown[]): FakeD1Statement {
		// D1's documented limit: 100 bound parameters per query.
		if (values.length > D1_MAX_PARAMS) throw new Error(`D1_ERROR: too many SQL variables (${values.length} > ${D1_MAX_PARAMS})`);
		return new FakeD1Statement(this.d1, this.sql, values.map(toSqlite));
	}

	/** @internal Runs the statement against SQLite (no round-trip accounting). */
	execute(): Executed {
		if (TRANSACTION_SQL.test(this.sql)) {
			throw new Error('D1_ERROR: To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.');
		}
		this.d1.hooks.statement?.();
		const stmt = this.d1.sqlite.prepare(this.sql);
		if (stmt.reader) {
			const columns = stmt.columns().map((c) => c.name);
			const rows = (stmt.raw(true).all(...this.params) as unknown[][]).map((r) => r.map(fromSqlite));
			return { columns, rows, changes: 0, lastRowId: 0 };
		}
		const info = stmt.run(...this.params);
		return { columns: [], rows: [], changes: info.changes, lastRowId: Number(info.lastInsertRowid) };
	}

	/** @internal The `all()` shape, from an execution. `strict`: see `FakeD1.strictColumns`. */
	result(x: Executed, strict = this.d1.strictColumns): D1Result<Row> {
		return { results: this.d1.objects(x, this.sql, strict), success: true, meta: meta(x) };
	}

	async all<T = Row>(): Promise<D1Result<T>> {
		return this.d1.single(() => this.result(this.execute())) as D1Result<T>;
	}

	/** Same shape as `all()`; its rows are rarely read (`select 1` health checks), so never strict. */
	async run<T = Row>(): Promise<D1Result<T>> {
		return this.d1.single(() => this.result(this.execute(), false)) as D1Result<T>;
	}

	async first<T = unknown>(column?: string): Promise<T | null> {
		const { results } = await this.all<Row>();
		const row = results[0];
		if (!row) return null;
		if (column === undefined) return row as T;
		if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
		return row[column] as T;
	}

	async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
		return this.d1.single(() => {
			const x = this.execute();
			return (options?.columnNames ? [x.columns, ...x.rows] : x.rows) as T[];
		});
	}
}

function meta(x: Executed): Meta {
	return {
		duration: 0,
		size_after: 0,
		rows_read: x.rows.length,
		rows_written: x.changes,
		last_row_id: x.lastRowId,
		changed_db: x.changes > 0,
		changes: x.changes
	} as Meta;
}

export class FakeD1 {
	hooks: FakeD1Hooks = {};
	/** Throw on object results whose column names repeat or look like array indices (see the header). */
	strictColumns = true;

	constructor(readonly sqlite: Database.Database) {}

	prepare(query: string): FakeD1Statement {
		return new FakeD1Statement(this, query);
	}

	async batch<T = Row>(statements: FakeD1Statement[]): Promise<D1Result<T>[]> {
		this.hooks.roundTrip?.();
		const run = this.sqlite.transaction(() => statements.map((s) => s.result(s.execute())));
		return run() as D1Result<T>[];
	}

	async exec(query: string): Promise<D1ExecResult> {
		this.hooks.roundTrip?.();
		this.sqlite.exec(query);
		return { count: 1, duration: 0 };
	}

	withSession(): this {
		return this;
	}

	/** @internal */
	single<T>(fn: () => T): T {
		this.hooks.roundTrip?.();
		return fn();
	}

	/** @internal Rows as workerd builds them: `Object.fromEntries` over the column names. */
	objects(x: Executed, sql: string, strict: boolean): Row[] {
		if (strict && x.rows.length) {
			const seen = new Set<string>();
			for (const c of x.columns) {
				if (seen.has(c) || INDEX_LIKE.test(c)) {
					throw new Error(
						`FakeD1: column "${c}" ${seen.has(c) ? 'repeats' : 'is an integer-like name'} in an object result. ` +
							`D1 returns rows as objects, so Drizzle's db.batch() would map every later field wrong. ` +
							`Give each selected column a unique name (see docs/contracts.md, "As built"). SQL: ${sql}`
					);
				}
				seen.add(c);
			}
		}
		return x.rows.map((r) => Object.fromEntries(r.map((v, i) => [x.columns[i], v])));
	}
}

export type TestDb = DB & { $sqlite: Database.Database; $d1: FakeD1 };

/** A migrated, empty database behind the production Drizzle D1 driver. */
export function createTestDb(): TestDb {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	for (const statement of migrationStatements()) sqlite.exec(statement);
	const d1 = new FakeD1(sqlite);
	const db = getDb(d1 as unknown as D1Database) as TestDb;
	Object.defineProperty(db, '$sqlite', { value: sqlite, enumerable: false });
	Object.defineProperty(db, '$d1', { value: d1, enumerable: false });
	return db;
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

/** Counts the statements and D1 round trips `db` runs from now on. */
export function countQueries(db: TestDb): QueryStats {
	const stats: QueryStats = {
		statements: 0,
		roundTrips: 0,
		reset() {
			stats.statements = 0;
			stats.roundTrips = 0;
		}
	};
	db.$d1.hooks = {
		statement: () => void stats.statements++,
		roundTrip: () => void stats.roundTrips++
	};
	return stats;
}
