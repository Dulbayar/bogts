<script lang="ts">
	import { plural } from '$lib/format';
	import { deliveryStatus, type DeliveryState } from '$lib/status';
	import StatusBadge from './StatusBadge.svelte';

	let {
		delivery,
		detail = false
	}: {
		delivery: { state: DeliveryState; attempts: number; lastStatus: number | null } | null;
		detail?: boolean;
	} = $props();
</script>

{#if delivery}
	<StatusBadge status={deliveryStatus(delivery.state)} />
	{#if detail && delivery.attempts > 0}
		<span class="subtle meta"
			>{#if delivery.lastStatus}{delivery.lastStatus}&nbsp;·&nbsp;{/if}{plural(delivery.attempts, 'attempt', 'attempts')}</span
		>
	{/if}
{:else}
	<span class="subtle">—</span>
{/if}

<style>
	.meta {
		font-size: var(--text-xs);
		margin-left: 4px;
		white-space: nowrap;
	}
</style>
