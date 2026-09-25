import { describe, expect, it } from 'vitest';
import { Bogts, BogtsError } from '../src/index.js';

type Call = { url: URL; method: string; headers: Headers; body: unknown };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const call: Call = {
			url: new URL(String(input)),
			method: init?.method ?? 'GET',
			headers: new Headers(init?.headers),
			body: init?.body ? JSON.parse(String(init.body)) : undefined
		};
		calls.push(call);
		return respond(call);
	}) as typeof globalThis.fetch;
	return { fetch, calls };
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const client = (respond: Parameters<typeof fakeFetch>[0]) => {
	const f = fakeFetch(respond);
	return { bogts: new Bogts({ apiKey: 'bgk_test', baseUrl: 'https://pay.test/', fetch: f.fetch }), calls: f.calls };
};

describe('Bogts client', () => {
	it('POSTs with the API key, JSON body and an auto idempotency key', async () => {
		const { bogts, calls } = client(() => json({ id: 'inv_1', object: 'invoice' }, 201));
		const input = { provider: 'qpay' as const, amount: 10000, reference: 'order-42', description: 'Order 42' };
		const inv = await bogts.invoices.create(input);
		expect(inv.id).toBe('inv_1');
		const [c] = calls;
		expect(c!.method).toBe('POST');
		expect(c!.url.toString()).toBe('https://pay.test/v1/invoices');
		expect(c!.headers.get('authorization')).toBe('Bearer bgk_test');
		expect(c!.headers.get('content-type')).toBe('application/json');
		expect(c!.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
		expect(c!.body).toEqual(input);

		await bogts.invoices.create(input);
		expect(calls[1]!.headers.get('idempotency-key')).not.toBe(c!.headers.get('idempotency-key'));
	});

	it('invoices.create says whether the invoice was reused', async () => {
		const reply = (status: number, reused?: string) =>
			new Response(JSON.stringify({ id: 'inv_1', object: 'invoice' }), {
				status,
				headers: { 'content-type': 'application/json', ...(reused === undefined ? {} : { 'bogts-reused': reused }) }
			});
		const input = { provider: 'qpay' as const, amount: 10000, reference: 'order-42', description: 'Order 42' };
		expect(await client(() => reply(201, 'false')).bogts.invoices.create(input)).toEqual({ id: 'inv_1', object: 'invoice', reused: false });
		expect(await client(() => reply(200, 'true')).bogts.invoices.create(input)).toMatchObject({ id: 'inv_1', reused: true });
		// Without the header (an older gateway), the status decides.
		expect((await client(() => reply(200)).bogts.invoices.create(input)).reused).toBe(true);
		expect((await client(() => reply(201)).bogts.invoices.create(input)).reused).toBe(false);
		// Only create carries it.
		expect(await client(() => reply(200, 'true')).bogts.invoices.get('inv_1')).not.toHaveProperty('reused');
	});

	it('uses the given idempotency key', async () => {
		const { bogts, calls } = client(() => json({ id: 'ch_1' }));
		await bogts.charges.create({ subscriptionId: 'sub_1', amount: 5000, reference: 'r' }, { idempotencyKey: 'order-42' });
		await bogts.invoices.cancel('inv_1', { idempotencyKey: 'cancel-1' });
		expect(calls.map((c) => c.headers.get('idempotency-key'))).toEqual(['order-42', 'cancel-1']);
	});

	it('maps every method to its route', async () => {
		const { bogts, calls } = client(() => json({ object: 'list', data: [], hasMore: false, nextCursor: null }));
		await bogts.invoices.get('inv 1');
		await bogts.invoices.list({ limit: 5, cursor: 'c1' });
		await bogts.invoices.cancel('inv_1');
		await bogts.subscriptions.create({ plan: 'pro', customerRef: 'u1', returnUrl: 'https://x.test' });
		await bogts.subscriptions.get('sub_1');
		await bogts.subscriptions.list();
		await bogts.subscriptions.cancel('sub_1');
		await bogts.subscriptions.replaceCard('sub_1');
		await bogts.charges.get('ch_1');
		await bogts.charges.list({ limit: 2 });
		await bogts.charges.reverse('ch_1');
		await bogts.events.get('ev_1');
		await bogts.events.list({ type: ['invoice.paid', 'charge.failed'], limit: 3 });
		expect(calls.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`)).toEqual([
			'GET /v1/invoices/inv%201',
			'GET /v1/invoices?limit=5&cursor=c1',
			'POST /v1/invoices/inv_1/cancel',
			'POST /v1/subscriptions',
			'GET /v1/subscriptions/sub_1',
			'GET /v1/subscriptions',
			'DELETE /v1/subscriptions/sub_1',
			'POST /v1/subscriptions/sub_1/card',
			'GET /v1/charges/ch_1',
			'GET /v1/charges?limit=2',
			'POST /v1/charges/ch_1/reverse',
			'GET /v1/events/ev_1',
			'GET /v1/events?type=invoice.paid%2Ccharge.failed&limit=3'
		]);
		// Only POSTs get an idempotency key by default.
		expect(calls.filter((c) => c.headers.has('idempotency-key')).length).toBe(calls.filter((c) => c.method === 'POST').length);
	});

	it('accepts a baseUrl ending in /v1', async () => {
		const f = fakeFetch(() => json({}));
		await new Bogts({ apiKey: 'k', baseUrl: 'https://pay.test/v1', fetch: f.fetch }).charges.get('x');
		expect(f.calls[0]!.url.toString()).toBe('https://pay.test/v1/charges/x');
	});

	it('throws BogtsError with the API code and message', async () => {
		const { bogts } = client(() => json({ error: { code: 'not_found', message: 'Invoice not found' } }, 404));
		const err = await bogts.invoices.get('nope').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(BogtsError);
		expect(err).toMatchObject({ status: 404, code: 'not_found', message: 'Invoice not found' });
	});

	it('throws BogtsError for a non-JSON error and for a network failure', async () => {
		const { bogts } = client(() => new Response('<html>bad gateway</html>', { status: 502 }));
		await expect(bogts.invoices.get('x')).rejects.toMatchObject({ status: 502, code: 'http_error' });
		const down = new Bogts({
			apiKey: 'k',
			baseUrl: 'https://pay.test',
			fetch: (async () => {
				throw new TypeError('fetch failed');
			}) as typeof fetch
		});
		await expect(down.invoices.get('x')).rejects.toMatchObject({ status: 0, code: 'network_error' });
	});

	it('events.iterate pages oldest first from ?after until the end', async () => {
		const ids = ['01A', '01B', '01C', '01D', '01E'];
		const { bogts, calls } = client(({ url }) => {
			const after = url.searchParams.get('after') ?? '';
			const limit = Number(url.searchParams.get('limit') ?? 20);
			const rest = ids.filter((id) => id > after);
			const data = rest.slice(0, limit).map((id) => ({ id, object: 'event', type: 'invoice.paid', createdAt: '', data: {} }));
			return json({ object: 'list', data, hasMore: rest.length > limit, nextCursor: null });
		});
		const seen: string[] = [];
		for await (const e of bogts.events.iterate({ limit: 2 })) seen.push(e.id);
		expect(seen).toEqual(ids);
		expect(calls.map((c) => c.url.searchParams.get('after'))).toEqual(['', '01B', '01D']);

		const later: string[] = [];
		for await (const e of bogts.events.iterate({ after: '01C', limit: 2 })) later.push(e.id);
		expect(later).toEqual(['01D', '01E']);
	});
});
