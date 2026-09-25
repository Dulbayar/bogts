import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { subscription } from '$lib/server/schema';
import { createTestDb, seedPlan, seedProject } from '$lib/server/testdb';
import { GET } from './+server';

describe('GET /return/s/:id', () => {
	it('redirects to the project returnUrl with ?subscription=, and trusts nothing else', async () => {
		const db = createTestDb();
		const projectId = (await seedProject(db)).project.id;
		const plan = await seedPlan(db, projectId);
		await db.insert(subscription).values({
			id: 'SUB1',
			projectId,
			planId: plan.id,
			customerRef: 'c',
			status: 'pending',
			tokenizeTransactionId: 'SUB1',
			returnUrl: 'https://project.test/billing?tab=plan',
			createdAt: 1,
			updatedAt: 1
		});
		const run = (id: string, search = '') =>
			(GET as unknown as (e: RequestEvent) => Promise<Response>)({
				params: { id },
				url: new URL(`https://payments.test/return/s/${id}${search}`),
				locals: { db }
			} as unknown as RequestEvent);
		const res = await run('SUB1', '?status=SUCCESS');
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe('https://project.test/billing?tab=plan&subscription=SUB1');
		expect((await run('NOPE')).status).toBe(404);
		expect((await run('../x')).status).toBe(404);
	});
});
