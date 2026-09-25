<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		tone = 'info',
		children,
		role
	}: { tone?: 'info' | 'warning' | 'danger' | 'muted' | 'success'; children: Snippet; role?: 'alert' | 'status' } = $props();

	const icon = $derived(tone === 'danger' ? 'x' : tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'dot');
</script>

<div class="callout {tone}" {role}>
	<Icon name={icon} size={16} />
	<div class="text">{@render children()}</div>
</div>

<style>
	.callout {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--neutral-border);
		background: var(--neutral-bg);
		color: var(--neutral-fg);
		font-size: var(--text-sm);
		line-height: var(--lh-sm);
	}
	.callout :global(.icon) {
		margin-top: 2px;
	}
	.text {
		min-width: 0;
		overflow-wrap: anywhere;
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
	.success {
		background: var(--success-bg);
		border-color: var(--success-border);
		color: var(--success-fg);
	}
	.text :global(a) {
		color: inherit;
		text-decoration: underline;
	}
</style>
