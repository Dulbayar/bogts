import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStatus, pollStatus } from './checkout';

const ID = '01K5ZQ8X2C4Y6V8R0T2W4Y6A8C';

function answer(body: unknown, status = 200) {
	const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
	vi.stubGlobal('fetch', fetch);
	return fetch;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('fetchStatus', () => {
	it('makes one real request and returns the status', async () => {
		const fetch = answer({ status: 'paid', paidAt: null, returnUrl: null });
		expect(await fetchStatus(ID)).toBe('paid');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0]).toEqual([`/pay/${ID}/status`, expect.objectContaining({ cache: 'no-store' })]);
	});

	it('returns null on an error answer or a network failure', async () => {
		answer({ error: { code: 'rate_limited' } }, 429);
		expect(await fetchStatus(ID)).toBeNull();
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
		expect(await fetchStatus(ID)).toBeNull();
	});
});

describe('pollStatus', () => {
	it('reports each status and stops at a final one', async () => {
		vi.useFakeTimers();
		answer({ status: 'paid' });
		const onStatus = vi.fn();
		pollStatus(ID, { until: Date.now() + 60_000, onStatus });
		await vi.advanceTimersByTimeAsync(3000);
		expect(onStatus).toHaveBeenCalledWith('paid');
		await vi.advanceTimersByTimeAsync(30_000);
		expect(onStatus).toHaveBeenCalledTimes(1);
	});
});
