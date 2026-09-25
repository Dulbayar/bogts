/**
 * QPay's callback. The body is never read (see `providers/qpay/callback.ts`):
 * QPay only tells us which invoice to go and ask about.
 */
import { requireConfig } from '$lib/server/locals';
import { callbackResponse, processQpayCallback } from '$lib/server/providers/qpay/callback';
import type { RequestHandler } from './$types';

const run: RequestHandler = async ({ locals, params }) => {
	try {
		const config = requireConfig(locals);
		const ctx = { db: locals.db, config, waitUntil: locals.waitUntil };
		return callbackResponse(await processQpayCallback(ctx, params.invoiceId));
	} catch (err) {
		// D1 or config trouble: let QPay retry. Our id only, never a body.
		console.error('[qpay] callback failed', params.invoiceId, err instanceof Error ? err.name : typeof err);
		return new Response('RETRY', { status: 503, headers: { 'retry-after': '60', 'cache-control': 'no-store' } });
	}
};

export const GET = run;
export const POST = run;
