/**
 * A fake QPay v2 merchant API for tests, installed with
 * `vi.stubGlobal('fetch', fake.fetch)`. It answers the exact URLs qpay-js 1.0.0
 * calls: `POST /v2/auth/token` (Basic), `POST /v2/auth/refresh` (Bearer
 * refresh token), `POST /v2/invoice`, `POST /v2/payment/check`,
 * `DELETE /v2/invoice/:id`. Wire format is snake_case, amounts in check rows
 * are decimal strings, and `expires_in` is absolute epoch seconds, as the
 * sandbox answers.
 *
 * Test scaffolding only.
 */
import { vi } from 'vitest';

export const QPAY_SANDBOX = 'https://merchant-sandbox.qpay.mn';

export type FakeRow = { payment_id: string; payment_status: string; payment_amount: string };

export interface FakeQpay {
	fetch: ReturnType<typeof vi.fn>;
	/** Every call, as `METHOD /path`. */
	calls: string[];
	/** Request bodies of `POST /v2/invoice`, parsed. */
	created: Record<string, unknown>[];
	/** payment/check rows per QPay invoice id. */
	payments: Map<string, FakeRow[]>;
	/** Tokens minted so far. */
	mints: number;
	refreshes: number;
	/** Force a status on the next matching call(s): `'POST /v2/payment/check' → 500`. */
	failures: Map<string, { status: number; body?: string; times?: number }>;
	/** Access tokens the API refuses with 401. */
	revoked: Set<string>;
	/** Pay a QPay invoice (as a bank app would). */
	pay(qpayInvoiceId: string, amount: number, status?: string): string;
	count(call: string): number;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeQpay(): FakeQpay {
	let seq = 0;
	const fake: FakeQpay = {
		calls: [],
		created: [],
		payments: new Map(),
		mints: 0,
		refreshes: 0,
		failures: new Map(),
		revoked: new Set(),
		pay(qpayInvoiceId, amount, status = 'PAID') {
			const id = `pay-${++seq}`;
			const rows = fake.payments.get(qpayInvoiceId) ?? [];
			rows.push({ payment_id: id, payment_status: status, payment_amount: `${amount}.00` });
			fake.payments.set(qpayInvoiceId, rows);
			return id;
		},
		count: (call) => fake.calls.filter((c) => c === call).length,
		fetch: vi.fn()
	};

	const token = (kind: 'mint' | 'refresh') => {
		const n = kind === 'mint' ? ++fake.mints : ++fake.refreshes;
		const exp = Math.floor(Date.now() / 1000) + 86_400;
		return json({
			token_type: 'bearer',
			refresh_expires_in: exp,
			refresh_token: `rt-${kind}-${n}`,
			access_token: `at-${kind}-${n}`,
			expires_in: exp,
			scope: 'get_token',
			'not-before-policy': '0',
			session_state: 'sandbox'
		});
	};

	fake.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		const method = (init.method ?? 'GET').toUpperCase();
		const call = `${method} ${url.pathname.replace(/\/v2\/invoice\/.+$/, '/v2/invoice/:id')}`;
		fake.calls.push(call);
		if (url.origin !== QPAY_SANDBOX) return json({ error: 'WRONG_HOST' }, 404);

		const failure = fake.failures.get(call);
		if (failure) {
			if (failure.times !== undefined && --failure.times <= 0) fake.failures.delete(call);
			return new Response(failure.body ?? '<html>secret upstream body</html>', { status: failure.status });
		}

		const auth = new Headers(init.headers).get('authorization') ?? '';
		if (call === 'POST /v2/auth/token') {
			if (auth !== `Basic ${btoa('TEST_CLIENT:test-password')}`) return json({ error: 'AUTHENTICATION_FAILED' }, 401);
			return token('mint');
		}
		if (call === 'POST /v2/auth/refresh') {
			if (!auth.startsWith('Bearer rt-')) return json({ error: 'AUTHENTICATION_FAILED' }, 401);
			return token('refresh');
		}
		const bearer = auth.replace(/^Bearer /, '');
		if (!bearer.startsWith('at-') || fake.revoked.has(bearer)) return json({ error: 'NO_CREDENDIALS' }, 401);

		const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
		if (call === 'POST /v2/invoice') {
			fake.created.push(body);
			const id = `qp-${String(body.sender_invoice_no)}`;
			return json({
				invoice_id: id,
				qr_text: `QRTEXT-${id}`,
				qr_image: 'iVBORw0KGgoAAAANSUhEUg==',
				qPay_shortUrl: `https://sandbox-s.qpay.mn/${id}`,
				urls: [
					{ name: 'Khan bank', description: 'Хаан банк', logo: 'https://s3.qpay.mn/khan.png', link: `khanbank://q?qPay_QRcode=${id}` },
					{ name: 'Evil', description: 'x', logo: 'http://insecure/logo.png', link: 'javascript:alert(1)' }
				]
			});
		}
		if (call === 'POST /v2/payment/check') {
			const rows = fake.payments.get(String(body.object_id)) ?? [];
			const paid = rows.filter((r) => r.payment_status === 'PAID').reduce((a, r) => a + Number(r.payment_amount), 0);
			return json(rows.length ? { count: rows.length, paid_amount: paid, rows } : { count: 0, rows: [] });
		}
		if (call === 'DELETE /v2/invoice/:id') return json({});
		return json({ error: 'NOT_FOUND' }, 404);
	});
	return fake;
}
