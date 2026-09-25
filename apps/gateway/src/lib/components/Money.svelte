<script lang="ts">
	import { formatMoney, formatMoneyCompact, moneyLabel } from '$lib/format';

	let {
		amount,
		compact = false,
		struck = false
	}: { amount: number | null | undefined; compact?: boolean; struck?: boolean } = $props();
</script>

{#if amount === null || amount === undefined}
	<span class="subtle">—</span>
{:else if compact}
	<span class="money" title={formatMoney(amount)} aria-label={moneyLabel(amount)}>{formatMoneyCompact(amount)}</span>
{:else}
	<span class="money" class:struck aria-label={moneyLabel(amount)}>{formatMoney(amount)}</span>
{/if}

<style>
	.money {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.struck {
		text-decoration: line-through;
		color: var(--fg-muted);
	}
</style>
