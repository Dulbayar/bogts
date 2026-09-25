import { describe, expect, it } from 'vitest';
import { activityFor, recordActivity } from './activity';
import { createTestDb, seedProject } from './testdb';

describe('recordActivity', () => {
	it('records and lists a subject timeline, newest first', async () => {
		const db = createTestDb();
		const { project } = await seedProject(db);
		await recordActivity(db, { projectId: project.id, subjectType: 'invoice', subjectId: 'inv_1', source: 'gateway', kind: 'invoice.created', summary: 'Invoice created' }, 1);
		await recordActivity(db, { projectId: project.id, subjectType: 'invoice', subjectId: 'inv_1', source: 'provider', kind: 'qpay.callback.unverified', summary: 'Callback did not verify' }, 2);
		await recordActivity(db, { subjectType: 'provider', source: 'gateway', kind: 'bonum.auth.failed', summary: 'Bonum refused the credentials' }, 3);
		const rows = await activityFor(db, 'invoice', 'inv_1');
		expect(rows.map((r) => r.kind)).toEqual(['qpay.callback.unverified', 'invoice.created']);
	});

	it('trims long summaries and refuses a malformed kind', async () => {
		const db = createTestDb();
		await recordActivity(db, { subjectType: 'provider', source: 'gateway', kind: 'x.y', summary: 'a'.repeat(1000) });
		const [row] = await db.query.activity.findMany();
		expect(row?.summary.length).toBe(280);
		await expect(recordActivity(db, { subjectType: 'provider', source: 'gateway', kind: 'Bad Kind', summary: 's' })).rejects.toThrow();
	});
});
