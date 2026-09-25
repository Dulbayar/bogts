import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { createTestDb, seedPlan, seedProject, testConfig } from '../../testdb';
import { resetBonumTokenCache } from './client';
import { validatePlan } from './plans';
import { fakeBonum, jsonResponse } from './testing';

const PLANS = 'GET /mpay-service/merchant/values/payment-plans';

/** Bonum's "List Of Payment Plans" sample, plus a yearly plan. */
const planList = (extra: object[] = []) =>
	jsonResponse({
		traceId: '6960b2d3ec9f9d4a44caf66d5b4a5d26',
		errorCode: null,
		error: null,
		message: null,
		data: [
			{ planId: 1, name: 'Test Weekly Plan 1_prod', remark: 'Remark', createdAt: '2025-03-20 15:53:51', recurringType: 'WEEKLY', amount: 5.0, status: 'ACTIVE', cardCount: 0, retryCount: 3 },
			{ planId: 21, name: 'Monthly', remark: 'Monhtly Plan', createdAt: '2026-01-08 16:21:30', recurringType: 'MONTHLY', amount: 9.0, status: 'ACTIVE', cardCount: 0, retryCount: 3 },
			...extra
		],
		detail: null,
		duration: 686,
		status: 200
	});

let ctx: ServiceContext;
let projectId: string;

beforeEach(async () => {
	const db = createTestDb();
	ctx = { db, config: testConfig(), now: 1_000 };
	projectId = (await seedProject(db)).project.id;
	resetBonumTokenCache();
});
afterEach(() => vi.unstubAllGlobals());

const plan = (opts: Parameters<typeof seedPlan>[2]): Promise<Plan> => seedPlan(ctx.db, projectId, opts);

describe('validatePlan', () => {
	it('passes a matching plan', async () => {
		fakeBonum({ [PLANS]: () => planList() });
		const r = await validatePlan(ctx, await plan({ providerPlanId: 21, amount: 9, interval: 'monthly' }));
		expect(r).toEqual({ ok: true, problems: [], remote: { name: 'Monthly', amount: 9, recurringType: 'MONTHLY', status: 'ACTIVE' } });
	});

	it('reports a wrong amount and interval', async () => {
		fakeBonum({ [PLANS]: () => planList() });
		const r = await validatePlan(ctx, await plan({ providerPlanId: 1, amount: 9, interval: 'monthly' }));
		expect(r.ok).toBe(false);
		expect(r.problems).toHaveLength(2);
		expect(r.problems.join(' ')).toMatch(/WEEKLY/);
	});

	it('reports an inactive plan and a missing one', async () => {
		fakeBonum({
			[PLANS]: () => planList([{ planId: 30, name: 'Old', recurringType: 'YEARLY', amount: 100, status: 'INACTIVE' }])
		});
		const inactive = await validatePlan(ctx, await plan({ key: 'old', providerPlanId: 30, amount: 100, interval: 'yearly' }));
		expect(inactive.ok).toBe(false);
		expect(inactive.problems[0]).toMatch(/not active/);
		const missing = await validatePlan(ctx, await plan({ key: 'gone', providerPlanId: 999 }));
		expect(missing).toMatchObject({ ok: false, remote: null });
	});
});
