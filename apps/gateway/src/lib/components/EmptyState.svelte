<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	let { icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: Snippet } = $props();
</script>

<div class="empty">
	<Icon name={icon} size={32} />
	<p class="title">{title}</p>
	{#if children}<div class="more">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		padding: var(--space-10) var(--space-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background: var(--bg);
		color: var(--fg-subtle);
		text-align: center;
	}
	.title {
		color: var(--fg);
		font-weight: var(--weight-medium);
	}
	.more {
		font-size: var(--text-sm);
	}
</style>
