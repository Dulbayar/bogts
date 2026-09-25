/**
 * Where Bonum sends the payer's browser after card tokenization (checkout or a
 * card change). It only redirects to the project's `returnUrl` with
 * `?subscription=<id>`: state comes from webhooks, never from this request or
 * anything Bonum appends to it.
 */
import { eq } from 'drizzle-orm';
import { subscription } from '$lib/server/schema';
import type { RequestHandler } from './$types';

const notFound = () =>
	new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!/^[0-9A-Za-z]{1,64}$/.test(params.id)) return notFound();
	const [row] = await locals.db
		.select({ id: subscription.id, returnUrl: subscription.returnUrl })
		.from(subscription)
		.where(eq(subscription.id, params.id))
		.limit(1);
	if (!row?.returnUrl) return notFound();
	let target: URL;
	try {
		target = new URL(row.returnUrl);
	} catch {
		return notFound();
	}
	target.searchParams.set('subscription', row.id);
	return new Response(null, { status: 303, headers: { location: target.toString(), 'cache-control': 'no-store' } });
};
