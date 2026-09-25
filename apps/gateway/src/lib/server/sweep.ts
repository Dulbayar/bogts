/**
 * The expiry sweep (every 10 minutes, from `cron.ts`): each pending invoice
 * past `expires_at` is checked EXACTLY ONCE (docs/design.md).
 *
 * 1. Select up to 100 pending invoices past their expiry and with
 *    `swept_at IS NULL`, oldest expiry first. A provider with a status API
 *    (QPay) is due at `expires_at`; one without (Bonum hosted invoices) only
 *    at `expires_at + BONUM_EXPIRY_GRACE_MS`, so Bonum's webhook retries can
 *    still land first.
 * 2. Claim each with a conditional `UPDATE … SET swept_at = now WHERE swept_at
 *    IS NULL AND status = 'pending'`. Only the run that changed the row goes
 *    on, so two overlapping cron runs never check the same invoice.
 * 3. A provider with a status API (QPay) is asked once: paid → `settleInvoice`
 *    (`invoice.paid`); otherwise `invoice.expired`. A provider without one
 *    (Bonum: its status endpoint is test-only) is expired locally.
 * 4. A provider error during the check still counts as the one check: the
 *    invoice is expired and `sweep.check_failed` is recorded. Money that arrives
 *    later (a QPay callback, a Bonum PAYMENT webhook) is still honoured by
 *    `settleInvoice`.
 *
 * A run that died between the claim and the end would leave an invoice
 * pending with `swept_at` set. Such rows are expired (without a second check)
 * once their claim is `STALE_CLAIM_MS` old.
 *
 * The late check (`lateCheckExpired`, same cadence): QPay keeps accepting
 * payment on an old QR and its callback can be lost, so a QPay invoice that
 * ended `expired` or `cancelled` (by the project, or as the sibling of a paid
 * invoice) is asked ONE more time, about `LATE_CHECK_AFTER_MS` (24 h) after
 * its expiry, claimed through `late_checked_at` the same way. Paid → settled,
 * `invoice.paid` follows `invoice.expired` (or the silent cancel).
 *
 * Imported from the Worker entry through `cron.ts`: relative imports only.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notInArray, or } from 'drizzle-orm';
import { recordActivity } from './activity';
import type { DB } from './db';
import type { Config } from './env';
import { invoice as invoiceTable, PROVIDERS, type Invoice } from './schema';
import type { ServiceContext } from './services/context';
import { invoiceAdapters } from './services/invoices';
import { endInvoice, settleInvoice } from './services/settle';

export const SWEEP_BATCH = 100;
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * A provider with no status API (Bonum's hosted invoice) is expired only this
 * long after `expiresAt`: its PAYMENT webhook is the only proof of payment, and
 * Bonum retries a webhook it could not deliver. A PAYMENT webhook after the
 * grace still settles the invoice (`invoice.paid` follows `invoice.expired`).
 */
export const BONUM_EXPIRY_GRACE_MS = 2 * 60 * 60 * 1000;

/** The late check asks QPay about an expired invoice this long after its expiry. */
export const LATE_CHECK_AFTER_MS = 24 * 60 * 60 * 1000;
/** Invoices that expired longer ago than this are never late-checked (no backfill of old history). */
export const LATE_CHECK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LATE_CHECK_BATCH = 100;

/** Providers whose invoices are expired locally (no status API), after the grace. */
const localExpiry = () => PROVIDERS.filter((p) => !invoiceAdapters[p].check);

const errorName = (err: unknown) => (err instanceof Error ? err.name : typeof err);

async function note(ctx: ServiceContext, inv: Invoice, kind: string, summary: string) {
	try {
		await recordActivity(
			ctx.db,
			{ projectId: inv.projectId, subjectType: 'invoice', subjectId: inv.id, source: 'gateway', kind, summary },
			ctx.now
		);
	} catch {
		/* the timeline is best effort; the invoice state is what matters */
	}
}

/** Claims one invoice for this run. True only for the run that set `swept_at`. */
async function claim(db: DB, id: string, now: number): Promise<boolean> {
	const rows = await db
		.update(invoiceTable)
		.set({ sweptAt: now, updatedAt: now })
		.where(and(eq(invoiceTable.id, id), isNull(invoiceTable.sweptAt), eq(invoiceTable.status, 'pending')))
		.returning({ id: invoiceTable.id });
	return rows.length === 1;
}

/** The one check of one claimed invoice. */
async function sweepOne(ctx: ServiceContext, inv: Invoice): Promise<void> {
	const check = invoiceAdapters[inv.provider].check;
	if (check && inv.providerInvoiceId) {
		let result: Awaited<ReturnType<typeof check>> | null = null;
		try {
			result = await check(ctx, inv);
		} catch (err) {
			await note(
				ctx,
				inv,
				'sweep.check_failed',
				`The expiry check could not reach the provider (${errorName(err)}); expired without it. A later payment is still honoured.`
			);
		}
		if (result?.paid) {
			const settled = await settleInvoice(ctx, inv, result);
			if (settled !== 'amount_mismatch') {
				await note(ctx, inv, 'sweep.paid', 'The expiry check found the invoice paid.');
				return;
			}
		}
	}
	if (await endInvoice(ctx, inv, 'expired', { swept: true })) {
		await note(ctx, inv, 'sweep.expired', 'Expired unpaid.');
	}
}

/** Settles expired invoices. Returns how many were swept. Never rejects. */
export async function sweepExpired(db: DB, config: Config, now: number): Promise<number> {
	const ctx: ServiceContext = { db, config, now };
	let swept = 0;
	try {
		const due = await db
			.select()
			.from(invoiceTable)
			.where(
				and(
					eq(invoiceTable.status, 'pending'),
					isNull(invoiceTable.sweptAt),
					or(
						and(notInArray(invoiceTable.provider, localExpiry()), lte(invoiceTable.expiresAt, now)),
						and(inArray(invoiceTable.provider, localExpiry()), lte(invoiceTable.expiresAt, now - BONUM_EXPIRY_GRACE_MS))
					)
				)
			)
			.orderBy(asc(invoiceTable.expiresAt), asc(invoiceTable.id))
			.limit(SWEEP_BATCH);
		for (const inv of due) {
			try {
				if (!(await claim(db, inv.id, now))) continue;
				swept++;
				await sweepOne(ctx, { ...inv, sweptAt: now });
			} catch (err) {
				console.error('[sweep] invoice failed', inv.id, errorName(err));
			}
		}

		// Claims whose run died before ending them: expire, never check again.
		const stale = await db
			.select()
			.from(invoiceTable)
			.where(
				and(
					eq(invoiceTable.status, 'pending'),
					isNotNull(invoiceTable.sweptAt),
					lte(invoiceTable.sweptAt, now - STALE_CLAIM_MS)
				)
			)
			.limit(SWEEP_BATCH);
		for (const inv of stale) {
			try {
				if (await endInvoice(ctx, inv, 'expired')) await note(ctx, inv, 'sweep.expired', 'Expired unpaid.');
			} catch (err) {
				console.error('[sweep] stale claim failed', inv.id, errorName(err));
			}
		}
	} catch (err) {
		console.error('[sweep] failed', errorName(err));
	}
	return swept;
}

/** QPay invoices in these states get the one late check. */
const LATE_CHECK_STATUSES = ['expired', 'cancelled'] as const;

/** Claims one ended invoice for its late check. True only for the run that set `late_checked_at`. */
async function claimLate(db: DB, id: string, now: number): Promise<boolean> {
	const rows = await db
		.update(invoiceTable)
		.set({ lateCheckedAt: now, updatedAt: now })
		.where(and(eq(invoiceTable.id, id), isNull(invoiceTable.lateCheckedAt), inArray(invoiceTable.status, LATE_CHECK_STATUSES)))
		.returning({ id: invoiceTable.id });
	return rows.length === 1;
}

/**
 * The one late check of QPay invoices that ended `expired` or `cancelled` (see the header).
 * Returns how many were checked. Never rejects.
 */
export async function lateCheckExpired(db: DB, config: Config, now: number): Promise<number> {
	const ctx: ServiceContext = { db, config, now };
	const check = invoiceAdapters.qpay.check;
	if (!check || !config.providers.qpay) return 0;
	let checked = 0;
	try {
		const due = await db
			.select()
			.from(invoiceTable)
			.where(
				and(
					inArray(invoiceTable.status, LATE_CHECK_STATUSES),
					isNull(invoiceTable.lateCheckedAt),
					eq(invoiceTable.provider, 'qpay'),
					isNotNull(invoiceTable.providerInvoiceId),
					lte(invoiceTable.expiresAt, now - LATE_CHECK_AFTER_MS),
					gt(invoiceTable.expiresAt, now - LATE_CHECK_MAX_AGE_MS)
				)
			)
			.orderBy(asc(invoiceTable.expiresAt), asc(invoiceTable.id))
			.limit(LATE_CHECK_BATCH);
		for (const inv of due) {
			try {
				if (!(await claimLate(db, inv.id, now))) continue;
				checked++;
				let result: Awaited<ReturnType<typeof check>>;
				try {
					result = await check(ctx, { ...inv, lateCheckedAt: now });
				} catch (err) {
					await note(ctx, inv, 'late_check.failed', `The late payment check could not reach QPay (${errorName(err)}); it is not repeated. A callback is still honoured.`);
					continue;
				}
				if (!result.paid) continue;
				const settled = await settleInvoice(ctx, inv, result);
				if (settled === 'settled') {
					await note(ctx, inv, 'late_check.paid', `The late payment check found the ${inv.status} invoice paid (its callback never arrived); honoured.`);
				}
			} catch (err) {
				console.error('[late-check] invoice failed', inv.id, errorName(err));
			}
		}
	} catch (err) {
		console.error('[late-check] failed', errorName(err));
	}
	return checked;
}
