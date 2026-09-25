import { describe, expect, it } from 'vitest';
import {
	API_KEY_PATTERN,
	WEBHOOK_SECRET_PATTERN,
	apiKeyDisplayPrefix,
	newApiKey,
	newId,
	newWebhookSecret,
	randomBase62
} from './ids';

describe('ids', () => {
	it('newId is a ULID and sorts in creation order, even within one millisecond', () => {
		const ids = Array.from({ length: 50 }, () => newId());
		for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect([...ids].sort()).toEqual(ids);
	});

	it('API keys and webhook secrets have the documented format', () => {
		const key = newApiKey();
		expect(key).toMatch(API_KEY_PATTERN);
		expect(newWebhookSecret()).toMatch(WEBHOOK_SECRET_PATTERN);
		expect(apiKeyDisplayPrefix(key)).toBe(key.slice(0, 12));
		expect(newApiKey()).not.toBe(key);
	});

	it('randomBase62 uses the whole alphabet', () => {
		const s = randomBase62(5000);
		expect(s).toHaveLength(5000);
		expect(new Set(s).size).toBe(62);
	});
});
