/**
 * Shared UI state: toasts, screen-reader announcements and the one ticker
 * that refreshes relative times (ux-brief §5: one shared 60 s timer, not a
 * timer per cell).
 */
import { browser } from '$app/environment';

export type Toast = { id: number; tone: 'success' | 'danger' | 'info'; text: string };

let nextId = 1;

export const ui = $state({ toasts: [] as Toast[], announcement: '' });

/** Shows a toast for 4 s (at most 3 stacked). */
export function toast(text: string, tone: Toast['tone'] = 'success'): void {
	const id = nextId++;
	ui.toasts = [...ui.toasts.slice(-2), { id, tone, text }];
	if (browser) setTimeout(() => dismiss(id), 4000);
}

export function dismiss(id: number): void {
	ui.toasts = ui.toasts.filter((t) => t.id !== id);
}

/** Says `text` through the polite live region (e.g. "Copied"). */
export function announce(text: string): void {
	ui.announcement = '';
	queueMicrotask(() => (ui.announcement = text));
}

export const clock = $state({ now: Date.now() });

let ticking = false;
/** Starts the shared minute ticker (idempotent; browser only). */
export function startClock(): void {
	if (!browser || ticking) return;
	ticking = true;
	clock.now = Date.now();
	setInterval(() => (clock.now = Date.now()), 60_000);
}

/** Copies text; resolves false when the clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		announce('Copied');
		return true;
	} catch {
		return false;
	}
}
