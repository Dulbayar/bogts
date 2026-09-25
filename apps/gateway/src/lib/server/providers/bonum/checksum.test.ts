import { describe, expect, it } from 'vitest';
import { checksumForms, compactJson, verifyBonumChecksum } from './checksum';
import { CARD_TOKEN_SUCCESS, PAYMENT_FAILED, PAYMENT_SUCCESS } from './fixtures';
import { sign } from './testing';

const KEY = '755753df1f8fb16da1131cc318f1bcec9b5df3e39ae5dee902900cd186e7ece8'; // Bonum's sandbox sample key

describe('compactJson', () => {
	it('strips whitespace outside strings and keeps number text exactly', () => {
		const compact = compactJson(PAYMENT_SUCCESS);
		expect(compact).toContain('"amount":10000.00,');
		expect(compact).not.toMatch(/\s(?=")/);
		expect(compact.startsWith('{"type":"PAYMENT","status":"SUCCESS"')).toBe(true);
	});

	it('keeps spaces, escaped quotes and backslashes inside strings', () => {
		expect(compactJson('{ "a" : "x y \\" z\\\\" , "b" : [ 1.50 , 2 ] }')).toBe('{"a":"x y \\" z\\\\","b":[1.50,2]}');
		expect(compactJson(CARD_TOKEN_SUCCESS)).toContain('"mask":"5150 23** **** 4778"');
		expect(compactJson(CARD_TOKEN_SUCCESS)).toContain('"name":"Голомт банк"');
	});

	it('the three forms differ for a pretty-printed decimal body', () => {
		const forms = checksumForms(PAYMENT_SUCCESS);
		expect(forms).toHaveLength(3);
		expect(forms[1]).toContain('10000.00');
		expect(forms[2]).toContain('"amount":10000,');
	});
});

describe('verifyBonumChecksum', () => {
	it.each([
		['PAYMENT success', PAYMENT_SUCCESS],
		['PAYMENT failed', PAYMENT_FAILED],
		['CARD-TOKEN', CARD_TOKEN_SUCCESS]
	])('%s: accepts a signature over the raw bytes', async (_name, raw) => {
		expect(await verifyBonumChecksum(raw, await sign(raw, KEY), KEY)).toBe(true);
	});

	it('accepts a signature over the compact text with decimals kept (10000.00)', async () => {
		const header = await sign(compactJson(PAYMENT_SUCCESS), KEY);
		// Bug #4: JSON.stringify(JSON.parse()) turns 10000.00 into 10000 and would not match.
		expect(await sign(JSON.stringify(JSON.parse(PAYMENT_SUCCESS)), KEY)).not.toBe(header);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS, header, KEY)).toBe(true);
	});

	it('accepts a signature over JSON.stringify(JSON.parse(raw))', async () => {
		const header = await sign(JSON.stringify(JSON.parse(PAYMENT_FAILED)), KEY);
		expect(await verifyBonumChecksum(PAYMENT_FAILED, header, KEY)).toBe(true);
	});

	it('accepts an upper-case hex header', async () => {
		const header = (await sign(PAYMENT_SUCCESS, KEY)).toUpperCase();
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS, header, KEY)).toBe(true);
	});

	it('rejects a wrong key, a changed amount, a missing or malformed header', async () => {
		const header = await sign(PAYMENT_SUCCESS, KEY);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS, header, 'other-key')).toBe(false);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS.replace('10000.00', '1.00'), header, KEY)).toBe(false);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS, null, KEY)).toBe(false);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS, 'not-hex', KEY)).toBe(false);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS, header, '')).toBe(false);
	});

	it('rejects a decimal amount rewritten as an integer when the compact form was signed', async () => {
		const header = await sign(compactJson(PAYMENT_SUCCESS), KEY);
		expect(await verifyBonumChecksum(PAYMENT_SUCCESS.replace('10000.00', '10000'), header, KEY)).toBe(false);
	});
});
