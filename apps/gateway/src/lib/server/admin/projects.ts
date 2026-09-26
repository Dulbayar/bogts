/**
 * Projects and plans for the dashboard: reads, and the writes that have no
 * service of their own (create, rename, webhook URL, signing secret, archive,
 * plan CRUD). API key rotation lives in `auth/api-key.ts`.
 *
 * Plan validation status: `validatePlan` (providers/bonum/plans.ts) answers,
 * and the dashboard records each answer as a `plan.validate` audit entry. The
 * newest entry at or after the plan's last edit is its status, so no schema
 * change is needed and every check leaves a trail.
 */
import { and, count, desc, eq, gte, inArray, isNull, ne, or, sql, type SQLWrapper } from 'drizzle-orm';
import { ApiError } from '../api/errors';
import { issueApiKey } from '../auth/api-key';
import { encrypt } from '../crypto';
import { batchSelect, type DB } from '../db';
import { newId, newWebhookSecret } from '../ids';
import {
	DELIVERY_STATUSES,
	auditLog,
	delivery,
	plan,
	project,
	subscription,
	type AuditLog,
	type Plan,
	type PlanInterval
} from '../schema';
import type { PlanCheck } from '$lib/status';
import { failingDelivery } from './common';

const WEEK = 7 * 86_400_000;

/* ------------------------------------------------------------------ *
 * Validation of inputs
 * ------------------------------------------------------------------ */

export function slugify(name: string): string {
	const s = name
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return s || 'project';
}

/** A webhook URL: `https://…`, or `http://localhost…` when `allowLocalHttp` (sandbox). Empty → null. */
export function parseWebhookUrl(raw: string, allowLocalHttp: boolean): string | null {
	const v = raw.trim();
	if (!v) return null;
	let url: URL;
	try {
		url = new URL(v);
	} catch {
		throw new ApiError(400, 'invalid_request', 'Enter a full URL, like https://example.com/webhooks/bogts');
	}
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol === 'https:') return url.toString();
	if (url.protocol === 'http:' && local && allowLocalHttp) return url.toString();
	throw new ApiError(
		400,
		'invalid_request',
		allowLocalHttp ? 'Use https:// (http://localhost is allowed in sandbox)' : 'Use https://'
	);
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** The two reads behind `projectOptions`, for a caller's `db.batch`. */
export function projectOptionsStatements(db: DB, now = Date.now()) {
	return [
		db.select({ id: project.id, name: project.name, archivedAt: project.archivedAt }).from(project).orderBy(project.name),
		db
			.select(batchSelect({ projectId: delivery.projectId, n: count() }))
			.from(delivery)
			.where(and(failingDelivery, gte(delivery.createdAt, now - WEEK)))
			.groupBy(delivery.projectId)
	] as const;
}

type ProjectOptionRows = readonly [
	{ id: string; name: string; archivedAt: number | null }[],
	{ projectId: string; n: number }[]
];

export function projectOptionsFrom([rows, failing]: ProjectOptionRows) {
	const bad = new Set(failing.filter((f) => f.n > 0).map((f) => f.projectId));
	return rows.map((r) => ({ id: r.id, name: r.name, archived: r.archivedAt !== null, failing: bad.has(r.id) }));
}

/** All projects, A–Z, with a health dot: for the switcher. One round trip. */
export async function projectOptions(db: DB, now = Date.now()) {
	return projectOptionsFrom(await db.batch(projectOptionsStatements(db, now)));
}
export type ProjectOption = ReturnType<typeof projectOptionsFrom>[number];

/**
 * Delivery health per project over the last 7 days, as one statement. The
 * status list covers every status; it is there so `delivery_status_created_idx`
 * can serve the time window.
 */
export function deliveryHealthQuery(db: DB, now = Date.now(), projectId: string | null = null) {
	return db
		.select(
			batchSelect({
				projectId: delivery.projectId,
				total: count(),
				delivered: sql<number>`sum(case when ${delivery.status} = 'succeeded' then 1 else 0 end)`,
				failing: sql<number>`sum(case when ${failingDelivery} then 1 else 0 end)`,
				lastFailureAt: sql<number | null>`max(case when ${failingDelivery} then ${delivery.updatedAt} end)`
			})
		)
		.from(delivery)
		.where(
			and(
				inArray(delivery.status, DELIVERY_STATUSES),
				gte(delivery.createdAt, now - WEEK),
				projectId ? eq(delivery.projectId, projectId) : undefined
			)
		)
		.groupBy(delivery.projectId);
}

export function deliveryHealthFrom(rows: Awaited<ReturnType<typeof deliveryHealthQuery>>) {
	return new Map(
		rows.map((r) => [
			r.projectId,
			{ total: r.total, delivered: Number(r.delivered ?? 0), failing: Number(r.failing ?? 0), lastFailureAt: r.lastFailureAt ?? null }
		])
	);
}

/** Delivery health per project over the last 7 days (or for one project). */
export async function deliveryHealth(db: DB, now = Date.now(), projectId: string | null = null) {
	return deliveryHealthFrom(await deliveryHealthQuery(db, now, projectId));
}

export async function listProjects(db: DB, now = Date.now()) {
	const [rows, healthRows, planRows, validations] = await db.batch([
		db.select().from(project).orderBy(desc(project.id)),
		deliveryHealthQuery(db, now),
		db.select().from(plan),
		planValidations(db, db.select({ id: plan.id }).from(plan))
	]);
	const health = deliveryHealthFrom(healthRows);
	const checks = planChecksFrom(planRows, validations);
	return rows.map((p) => {
		const plans = planRows.filter((pl) => pl.projectId === p.id);
		return {
			id: p.id,
			name: p.name,
			slug: p.slug,
			apiKeyPrefix: p.apiKeyPrefix,
			webhookUrl: p.webhookUrl,
			archived: p.archivedAt !== null,
			createdAt: p.createdAt,
			health: health.get(p.id) ?? { total: 0, delivered: 0, failing: 0, lastFailureAt: null },
			planCount: plans.filter((pl) => pl.active).length,
			planMismatch: plans.some((pl) => pl.active && checks.get(pl.id)?.status === 'mismatch')
		};
	});
}

export type PlanCheckView = {
	status: PlanCheck;
	checkedAt: number | null;
	problems: string[];
	remote: { name: string; amount: number; recurringType: string; status: string } | null;
};

/**
 * The `plan.validate` audit entries of some plans, newest first. `planIds` is
 * a list or a subquery (so a caller can batch this with the plan read).
 */
export function planValidations(db: DB, planIds: string[] | SQLWrapper) {
	return db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.action, 'plan.validate'), inArray(auditLog.subject, planIds)))
		.orderBy(desc(auditLog.createdAt), desc(auditLog.id));
}

/** The latest validation of each plan (see the module note). */
export async function planChecks(db: DB, plans: Plan[]): Promise<Map<string, PlanCheckView>> {
	if (plans.length === 0) return new Map();
	return planChecksFrom(plans, await planValidations(db, plans.map((p) => p.id)));
}

/** `planChecks` from already-read `planValidations` rows. */
export function planChecksFrom(plans: Plan[], rows: AuditLog[]): Map<string, PlanCheckView> {
	const out = new Map<string, PlanCheckView>();
	for (const p of plans) {
		const r = rows.find((a) => a.subject === p.id && a.createdAt >= p.updatedAt);
		if (!r) {
			out.set(p.id, { status: 'unchecked', checkedAt: null, problems: [], remote: null });
			continue;
		}
		const d = (r.detail ?? {}) as { result?: string; problems?: string[]; remote?: PlanCheckView['remote'] };
		const status: PlanCheck = d.result === 'ok' ? 'verified' : d.result === 'mismatch' ? 'mismatch' : 'error';
		out.set(p.id, { status, checkedAt: r.createdAt, problems: d.problems ?? [], remote: d.remote ?? null });
	}
	return out;
}

export async function getProject(db: DB, id: string) {
	const [p] = await db.select().from(project).where(eq(project.id, id)).limit(1);
	return p ?? null;
}

export async function projectPlans(db: DB, projectId: string) {
	const ids = db.select({ id: plan.id }).from(plan).where(eq(plan.projectId, projectId));
	const [plans, validations, used] = await db.batch([
		db.select().from(plan).where(eq(plan.projectId, projectId)).orderBy(desc(plan.active), plan.key),
		planValidations(db, ids),
		db
			.select(batchSelect({ planId: subscription.planId, n: count() }))
			.from(subscription)
			.where(inArray(subscription.planId, ids))
			.groupBy(subscription.planId)
	]);
	const checks = planChecksFrom(plans, validations);
	const usedBy = new Map(used.map((u) => [u.planId, u.n]));
	return plans.map((p) => ({
		id: p.id,
		key: p.key,
		name: p.name,
		providerPlanId: p.providerPlanId,
		amount: p.amount,
		interval: p.interval,
		active: p.active,
		subscriptions: usedBy.get(p.id) ?? 0,
		check: checks.get(p.id)!
	}));
}
export type PlanView = Awaited<ReturnType<typeof projectPlans>>[number];

/** Subscriptions still running on a project (blocks archiving). */
export async function liveSubscriptionCount(db: DB, projectId: string): Promise<number> {
	const [r] = await db
		.select({ n: count() })
		.from(subscription)
		.where(and(eq(subscription.projectId, projectId), inArray(subscription.status, ['active', 'past_due'])));
	return r?.n ?? 0;
}

/** The last deliveries of a project, for the webhook tab. */
export async function recentDeliveries(db: DB, projectId: string, limit = 10) {
	return db
		.select({ delivery, eventType: sql<string>`(select type from event where event.id = ${delivery.eventId})` })
		.from(delivery)
		.where(eq(delivery.projectId, projectId))
		.orderBy(desc(delivery.id))
		.limit(limit);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

async function uniqueSlug(db: DB, name: string): Promise<string> {
	const base = slugify(name);
	const taken = await db
		.select({ slug: project.slug })
		.from(project)
		.where(sql`${project.slug} = ${base} or ${project.slug} like ${`${base}-%`}`);
	const set = new Set(taken.map((t) => t.slug));
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Creates a project. Returns the API key and signing secret in plain text: show them once. */
export async function createProject(
	db: DB,
	encryptionKey: string,
	input: { name: string; webhookUrl: string | null },
	now = Date.now()
): Promise<{ id: string; apiKey: string; webhookSecret: string }> {
	const name = input.name.trim();
	if (!name) throw new ApiError(400, 'invalid_request', 'Enter a name');
	if (name.length > 80) throw new ApiError(400, 'invalid_request', 'Keep the name under 80 characters');
	const id = newId();
	const { key, hash, prefix } = await issueApiKey();
	const webhookSecret = newWebhookSecret();
	await db.insert(project).values({
		id,
		name,
		slug: await uniqueSlug(db, name),
		apiKeyHash: hash,
		apiKeyPrefix: prefix,
		webhookUrl: input.webhookUrl,
		webhookSecretEnc: await encrypt(webhookSecret, encryptionKey),
		createdAt: now,
		updatedAt: now
	});
	return { id, apiKey: key, webhookSecret };
}

export async function renameProject(db: DB, id: string, name: string, now = Date.now()) {
	const v = name.trim();
	if (!v) throw new ApiError(400, 'invalid_request', 'Enter a name');
	if (v.length > 80) throw new ApiError(400, 'invalid_request', 'Keep the name under 80 characters');
	await db.update(project).set({ name: v, updatedAt: now }).where(eq(project.id, id));
}

export async function setWebhookUrl(db: DB, id: string, url: string | null, now = Date.now()) {
	await db.update(project).set({ webhookUrl: url, updatedAt: now }).where(eq(project.id, id));
}

/** A new signing secret, effective at once. Returned in plain text: show it once. */
export async function rotateWebhookSecret(db: DB, encryptionKey: string, id: string, now = Date.now()): Promise<string> {
	const secret = newWebhookSecret();
	await db
		.update(project)
		.set({ webhookSecretEnc: await encrypt(secret, encryptionKey), updatedAt: now })
		.where(eq(project.id, id));
	return secret;
}

/** Archived projects fail API auth; history stays. Refused while subscriptions are live. */
export async function archiveProject(db: DB, id: string, now = Date.now()) {
	const live = await liveSubscriptionCount(db, id);
	if (live > 0) throw new ApiError(409, 'conflict', 'Cancel its active subscriptions first');
	await db.update(project).set({ archivedAt: now, updatedAt: now }).where(and(eq(project.id, id), isNull(project.archivedAt)));
}

export async function restoreProject(db: DB, id: string, now = Date.now()) {
	await db.update(project).set({ archivedAt: null, updatedAt: now }).where(eq(project.id, id));
}

export type PlanInput = {
	key: string;
	name: string;
	providerPlanId: number;
	amount: number;
	interval: PlanInterval;
};

const PLAN_KEY = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function parsePlanInput(form: FormData): PlanInput {
	const key = String(form.get('key') ?? '').trim();
	const name = String(form.get('name') ?? '').trim() || key;
	const planId = Number(String(form.get('providerPlanId') ?? '').trim());
	const amount = Number(String(form.get('amount') ?? '').replace(/[,\s₮]/g, ''));
	const interval = String(form.get('interval') ?? '');
	if (!PLAN_KEY.test(key)) throw new ApiError(400, 'invalid_request', 'Key: lowercase letters, digits, - and _');
	if (!Number.isSafeInteger(planId) || planId <= 0) throw new ApiError(400, 'invalid_request', 'Bonum plan id must be a number');
	if (!Number.isSafeInteger(amount) || amount <= 0) throw new ApiError(400, 'invalid_request', 'Amount must be a whole number of tugrik');
	if (interval !== 'weekly' && interval !== 'monthly' && interval !== 'yearly') {
		throw new ApiError(400, 'invalid_request', 'Pick an interval');
	}
	return { key, name: name.slice(0, 80), providerPlanId: planId, amount, interval };
}

/** Creates or updates a plan (by id). Returns the stored row. */
export async function savePlan(db: DB, projectId: string, input: PlanInput, planId?: string | null, now = Date.now()): Promise<Plan> {
	const clash = await db
		.select({ id: plan.id })
		.from(plan)
		.where(and(eq(plan.projectId, projectId), eq(plan.key, input.key), planId ? ne(plan.id, planId) : undefined))
		.limit(1);
	if (clash.length) throw new ApiError(409, 'conflict', `This project already has a plan "${input.key}"`);
	if (planId) {
		const [row] = await db
			.update(plan)
			.set({ ...input, updatedAt: now })
			.where(and(eq(plan.id, planId), eq(plan.projectId, projectId)))
			.returning();
		if (!row) throw new ApiError(404, 'not_found', 'Plan not found');
		return row;
	}
	const [row] = await db
		.insert(plan)
		.values({ id: newId(), projectId, ...input, provider: 'bonum', createdAt: now, updatedAt: now })
		.returning();
	return row!;
}

export async function getPlan(db: DB, projectId: string, planId: string): Promise<Plan | null> {
	const [row] = await db
		.select()
		.from(plan)
		.where(and(eq(plan.id, planId), eq(plan.projectId, projectId)))
		.limit(1);
	return row ?? null;
}

/** Deletes a plan nobody subscribed to; otherwise switches it off (new checkouts stop). */
export async function removePlan(db: DB, projectId: string, planId: string): Promise<'deleted' | 'deactivated'> {
	const [used] = await db
		.select({ n: count() })
		.from(subscription)
		.where(or(eq(subscription.planId, planId), eq(subscription.nextPlanId, planId)));
	if ((used?.n ?? 0) > 0) {
		await db.update(plan).set({ active: false }).where(and(eq(plan.id, planId), eq(plan.projectId, projectId)));
		return 'deactivated';
	}
	await db.delete(plan).where(and(eq(plan.id, planId), eq(plan.projectId, projectId)));
	return 'deleted';
}

/** `updatedAt` is left alone: it marks definition changes, which reset the Bonum check. */
export async function setPlanActive(db: DB, projectId: string, planId: string, active: boolean) {
	await db.update(plan).set({ active }).where(and(eq(plan.id, planId), eq(plan.projectId, projectId)));
}
