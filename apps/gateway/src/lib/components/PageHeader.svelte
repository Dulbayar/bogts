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
		font-family: var(--font-display);
		font-size: 26px;
		line-height: 32px;
		font-weight: var(--weight-semibold);
		letter-spacing: -0.015em;
		overflow-wrap: anywhere;
	}
	.eyebrow {
		font-size: var(--text-sm);
		color: var(--fg-muted);
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
