import { sql } from 'drizzle-orm';
import { json } from '$lib/server/api/errors';
import type { RequestHandler } from './$types';

/**
 * Liveness for uptime checks: 200 when the Worker is configured and D1 answers,
 * 503 otherwise. Deliberately says nothing about which providers are on or what
 * is missing (the dashboard shows that).
 */
export const GET: RequestHandler = async ({ locals }) => {
	let database = true;
	try {
		await locals.db.run(sql`select 1`);
	} catch {
		database = false;
	}
	const configured = locals.config !== null;
	const ok = configured && database;
	return json({ status: ok ? 'ok' : 'unavailable', configured, database }, ok ? 200 : 503);
};
