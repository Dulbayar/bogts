<script lang="ts">
	import type { StatusView, Tone } from '$lib/status';
	import Icon, { type IconName } from './Icon.svelte';

	let { status, suffix }: { status: StatusView; suffix?: string } = $props();

	const GLYPH: Record<Tone, IconName> = {
		success: 'check',
		pending: 'clock',
		info: 'refresh',
		warning: 'alert',
		danger: 'x',
		muted: 'slash'
	};
</script>

<span class="badge {status.tone}"
	><Icon name={GLYPH[status.tone]} size={12} />{status.label}{#if suffix}<span class="suffix">{suffix}</span>{/if}</span
>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 6px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--neutral-border);
		background: var(--neutral-bg);
		color: var(--neutral-fg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		line-height: 1;
		white-space: nowrap;
		vertical-align: middle;
	}
	.success {
		background: var(--success-bg);
		border-color: var(--success-border);
		color: var(--success-fg);
	}
	.info {
		background: var(--info-bg);
		border-color: var(--info-border);
		color: var(--info-fg);
	}
	.warning {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning-fg);
	}
	.danger {
		background: var(--danger-bg);
		border-color: var(--danger-border);
		color: var(--danger-fg);
	}
	.muted {
		color: var(--fg-subtle);
	}
	.suffix {
		opacity: 0.8;
		font-weight: var(--weight-regular);
	}
	.suffix::before {
		content: '·';
		margin: 0 4px;
	}
</style>
