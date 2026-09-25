import { describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import { cursorSchema, ListQuery } from './paging';

describe('cursorSchema', () => {
	it('takes a ULID in either case and normalises it to uppercase', () => {
		const id = ulid();
		expect(cursorSchema.parse(id)).toBe(id);
		expect(cursorSchema.parse(id.toLowerCase())).toBe(id);
		expect(ListQuery.parse({ cursor: id.toLowerCase() })).toEqual({ limit: 20, cursor: id });
	});

	it('refuses anything else', () => {
		for (const bad of ['', 'bad', 'bgk_abc', `${ulid()}x`, 'I'.repeat(26), '01J-'.padEnd(26, '0')]) {
			expect(cursorSchema.safeParse(bad).success).toBe(false);
		}
	});
});
