/**
 * The public pages' status poller: GET `/pay/<id>/status` (JSON
 * `{ status, paidAt, returnUrl }`) every 3 s, backing off to 10 s after two
 * minutes, until a final status or `until`. Only the status is used from the
 * answer; the redirect target always comes from the server-rendered page.
 */
export type PolledStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';

export const FINAL = new Set(['paid', 'expired', 'failed', 'cancelled']);

/** One GET of the invoice's status, or null when it could not be read. */
export async function fetchStatus(invoiceId: string): Promise<PolledStatus | null> {
	try {
		const res = await fetch(`/pay/${invoiceId}/status`, { cache: 'no-store', headers: { accept: 'application/json' } });
		if (!res.ok) return null;
		const body = (await res.json()) as { status?: unknown };
		return typeof body.status === 'string' ? (body.status as PolledStatus) : null;
	} catch {
		return null;
	}
}

export function pollStatus(
	invoiceId: string,
	opts: { until: number; onStatus: (status: PolledStatus) => void; onGiveUp?: () => void }
): { stop: () => void; now: () => Promise<PolledStatus | null> } {
	const started = Date.now();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	async function check(): Promise<PolledStatus | null> {
		const status = await fetchStatus(invoiceId);
		if (status && !stopped) opts.onStatus(status);
		if (status && FINAL.has(status)) stop();
		return status;
	}

	function schedule() {
		if (stopped) return;
		if (Date.now() >= opts.until) {
			stop();
			opts.onGiveUp?.();
			return;
		}
		const delay = Date.now() - started < 120_000 ? 3000 : 10_000;
		timer = setTimeout(async () => {
			await check();
			schedule();
		}, delay);
	}

	function stop() {
		stopped = true;
		if (timer) clearTimeout(timer);
	}

	schedule();
	return { stop, now: check };
}
