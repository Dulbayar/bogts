/**
 * The activity timeline (`activity` table) the dashboard shows per payment,
 * subscription or charge, and per provider connection.
 *
 * `summary` is short safe text for people. NEVER put provider bodies, provider
 * messages, tokens, card data or secrets in it: `kind` carries the machine
 * meaning (`bonum.card_token.failed`), `summary` a plain sentence.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from './db';
import { newId } from './ids';
import { activity, type Activity, type ActivitySource, type ActivitySubjectType } from './schema';

export const ACTIVITY_SUMMARY_MAX = 280;
export const ACTIVITY_KIND_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

export interface ActivityInput {
	projectId?: string | null;
	subjectType: ActivitySubjectType;
	subjectId?: string | null;
	source: ActivitySource;
	/** e.g. `bonum.card_token.failed`, `qpay.callback.unverified`, `admin.subscription.cancel` */
	kind: string;
	summary: string;
}

/** Records one activity entry; `summary` is trimmed to 280 characters. Returns its id. */
export async function recordActivity(db: DB, input: ActivityInput, now = Date.now()): Promise<string> {
	if (!ACTIVITY_KIND_PATTERN.test(input.kind)) throw new Error(`invalid activity kind: ${input.kind}`);
	const id = newId();
	const summary = input.summary.length > ACTIVITY_SUMMARY_MAX ? `${input.summary.slice(0, ACTIVITY_SUMMARY_MAX - 1)}…` : input.summary;
	await db.insert(activity).values({
		id,
		projectId: input.projectId ?? null,
		subjectType: input.subjectType,
		subjectId: input.subjectId ?? null,
		source: input.source,
		kind: input.kind,
		summary,
		createdAt: now
	});
	return id;
}

/** A subject's timeline, newest first. */
export async function activityFor(
	db: DB,
	subjectType: ActivitySubjectType,
	subjectId: string,
	limit = 100
): Promise<Activity[]> {
	return db
		.select()
		.from(activity)
		.where(and(eq(activity.subjectType, subjectType), eq(activity.subjectId, subjectId)))
		.orderBy(desc(activity.createdAt), desc(activity.id))
		.limit(limit);
}
