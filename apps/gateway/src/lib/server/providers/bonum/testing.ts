/**
 * Test scaffolding for the Bonum module: a fake Bonum API behind
 * `vi.stubGlobal('fetch', …)`. Nothing outside tests may import this file.
 */
import { vi } from 'vitest';
import { hmacSha256Hex } from '../../crypto';

export type FakeCall = { method: string; path: string; url: URL; headers: Headers; body: unknown };
export type FakeRoute = (call: FakeCall, n: number) => Response | Promise<Response>;

export const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const AUTH_CREATE = 'GET /bonum-gateway/ecommerce/auth/create';
export const AUTH_REFRESH = 'GET /bonum-gateway/ecommerce/auth/refresh';

/** `auth/create` minting `tok-1`, `tok-2`, … (Bonum's sample answer shape). */
export const mintRoute: FakeRoute = (_call, n) =>
	jsonResponse({ tokenType: 'Bearer', accessToken: `tok-${n}`, expiresIn: 1800, refreshToken: `ref-${n}`, refreshExpiresIn: 2000, unit: 'SECONDS' });

/**
 * Stubs `fetch` with `routes` keyed `METHOD /path`. Unrouted calls answer 404.
 * `n` counts calls per route, from 1. Includes `auth/create` unless overridden.
 */
export function fakeBonum(routes: Record<string, FakeRoute> = {}) {
	const all: Record<string, FakeRoute> = { [AUTH_CREATE]: mintRoute, ...routes };
	const calls: FakeCall[] = [];
	const counts = new Map<string, number>();
	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const method = (init?.method ?? 'GET').toUpperCase();
		const text = typeof init?.body === 'string' ? init.body : undefined;
		const call: FakeCall = { method, path: url.pathname, url, headers: new Headers(init?.headers), body: text ? JSON.parse(text) : undefined };
		calls.push(call);
		const key = `${method} ${url.pathname}`;
		const n = (counts.get(key) ?? 0) + 1;
		counts.set(key, n);
		const route = all[key];
		return route ? route(call, n) : jsonResponse({ status: 404 }, 404);
	});
	vi.stubGlobal('fetch', fetchMock);
	return {
		calls,
		fetchMock,
		/** Calls to one route */
		to: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
		count: (key: string) => counts.get(key) ?? 0
	};
}

/** The `x-checksum-v2` Bonum would send for `text`. */
export const sign = (text: string, key: string) => hmacSha256Hex(key, text);
