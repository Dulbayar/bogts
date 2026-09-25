<!-- A time in Ulaanbaatar (ux-brief §5). The tooltip always has UB and UTC. -->
<script lang="ts">
	import { formatDateTime, formatFuture, formatRelative, formatTableTime, formatTooltip } from '$lib/format';
	import { clock } from '$lib/ui.svelte';

	let {
		at,
		mode = 'table'
	}: { at: number | null | undefined; mode?: 'table' | 'detail' | 'future' | 'relative' } = $props();

	const text = $derived.by(() => {
		if (at === null || at === undefined) return '—';
		const now = clock.now;
		if (mode === 'detail') return formatDateTime(at);
		if (mode === 'future') return formatFuture(at, now);
		if (mode === 'relative') return formatRelative(at, now);
		return formatTableTime(at, now);
	});
</script>

{#if at === null || at === undefined}
	<span class="subtle">—</span>
{:else}
	<time datetime={new Date(at).toISOString()} title={formatTooltip(at)}>{text}</time>
{/if}

<style>
	time {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
</style>
