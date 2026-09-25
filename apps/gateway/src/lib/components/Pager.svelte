<script lang="ts">
	import { page } from '$app/state';
	import { withParams } from '$lib/url';

	let { newer, older }: { newer: string | null; older: string | null } = $props();
</script>

{#if newer || older}
	<nav class="pager" aria-label="Pages">
		{#if newer}
			<a class="btn sm" href={withParams(page.url, { after: newer, before: null })}>← Newer</a>
		{:else}
			<span class="btn sm" aria-disabled="true">← Newer</span>
		{/if}
		{#if older}
			<a class="btn sm" href={withParams(page.url, { before: older, after: null })}>Older →</a>
		{:else}
			<span class="btn sm" aria-disabled="true">Older →</span>
		{/if}
	</nav>
{/if}

<style>
	.pager {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
</style>
