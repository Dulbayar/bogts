/**
 * Our plan rows against Bonum's payment plans (made in Bonum's merchant
 * portal). Checked before every checkout: an inactive plan, a different
 * interval or a different amount would bill customers something other than
 * what the project sells.
 */
import { MoneyError, toMnt } from '../../money';
import type { Plan } from '../../schema';
import type { ServiceContext } from '../../services/context';
import { bonumRequest } from './client';
import { RECURRING_TYPE } from './util';

export interface RemotePlan {
	planId: number;
	name: string;
	amount: number | string;
	recurringType: string;
	status: string;
}

export interface PlanValidation {
	ok: boolean;
	/** Safe sentences for people (our own text, never Bonum's) */
	problems: string[];
	/** Bonum's view of the plan; `amount` is 0 when Bonum's amount is unreadable (reported in `problems`) */
	remote: { name: string; amount: number; recurringType: string; status: string } | null;
}

export async function listBonumPlans(ctx: ServiceContext): Promise<RemotePlan[]> {
	const body = await bonumRequest<{ data?: unknown }>(ctx, 'payment-plans', '/mpay-service/merchant/values/payment-plans');
	const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
	return data.filter(
		(p): p is RemotePlan => !!p && typeof p === 'object' && typeof (p as RemotePlan).planId === 'number'
	);
}

/** Compares a plan row with Bonum's plan of the same id. Throws `BonumError` if Bonum cannot be asked. */
export async function validatePlan(ctx: ServiceContext, plan: Plan): Promise<PlanValidation> {
	const remote = (await listBonumPlans(ctx)).find((p) => p.planId === plan.providerPlanId);
	if (!remote) {
		return { ok: false, problems: [`Bonum has no payment plan with id ${plan.providerPlanId}`], remote: null };
	}
	let amount: number | null = null;
	try {
		amount = toMnt(remote.amount);
	} catch (err) {
		if (!(err instanceof MoneyError)) throw err;
	}
	// Enum-like values only: anything else is reported as `unknown`, never echoed.
	const safe = (v: unknown) => (typeof v === 'string' && /^[A-Z_]{1,20}$/.test(v) ? v : 'unknown');
	const status = safe(remote.status);
	const recurringType = safe(remote.recurringType);
	const problems: string[] = [];
	if (status !== 'ACTIVE') problems.push(`Bonum plan ${plan.providerPlanId} is not active (${status})`);
	if (recurringType !== RECURRING_TYPE[plan.interval]) {
		problems.push(`Bonum plan ${plan.providerPlanId} bills ${recurringType}, not ${RECURRING_TYPE[plan.interval]}`);
	}
	if (amount !== plan.amount) {
		problems.push(`Bonum plan ${plan.providerPlanId} costs ${amount ?? 'an invalid amount'}, not ${plan.amount} MNT`);
	}
	return {
		ok: problems.length === 0,
		problems,
		remote: { name: typeof remote.name === 'string' ? remote.name.slice(0, 200) : '', amount: amount ?? 0, recurringType, status }
	};
}
