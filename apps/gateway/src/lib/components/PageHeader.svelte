<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		eyebrow,
		actions,
		children
	}: { title: string; eyebrow?: Snippet; actions?: Snippet; children?: Snippet } = $props();
</script>

<header class="page-header">
	<div class="titles">
		{#if eyebrow}<div class="eyebrow">{@render eyebrow()}</div>{/if}
		<h1>{title}</h1>
		{#if children}<div class="sub">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-bottom: var(--space-5);
	}
	.titles {
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	h1 {
		font-size: var(--text-xl);
		line-height: var(--lh-xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		overflow-wrap: anywhere;
	}
	.eyebrow {
		font-size: var(--text-xs);
		color: var(--fg-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.sub {
		color: var(--fg-muted);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex-wrap: wrap;
	}
</style>
