<script lang="ts">
	import { truncateMiddle } from '$lib/format';
	import CopyButton from './CopyButton.svelte';

	let { id, href, full = false }: { id: string; href?: string | null; full?: boolean } = $props();
	const shown = $derived(full ? id : truncateMiddle(id));
</script>

<span class="chip">
	{#if href}
		<a class="mono" {href} title={id}>{shown}</a>
	{:else}
		<span class="mono" title={id}>{shown}</span>
	{/if}
	<span class="copy"><CopyButton value={id} label="Copy id" /></span>
</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		max-width: 100%;
		min-width: 0;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	span.mono {
		color: var(--fg);
	}
	/* Visible on hover/focus with a mouse; always on touch. */
	@media (hover: hover) {
		.copy {
			opacity: 0;
			transition: opacity var(--dur-fast) var(--ease);
		}
		.chip:hover .copy,
		.chip:focus-within .copy {
			opacity: 1;
		}
	}
</style>
