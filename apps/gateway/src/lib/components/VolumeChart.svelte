<!-- Daily volume bars (UB days), hand-drawn SVG. Each bar has a native tooltip. -->
<script lang="ts">
	import { formatDate, formatMoney, formatMoneyCompact, formatShortDate, plural } from '$lib/format';

	let { days }: { days: { day: number; volume: number; count: number }[] } = $props();

	const max = $derived(Math.max(1, ...days.map((d) => d.volume)));
	const W = 100;
	const H = 100;
	const gap = $derived(days.length > 45 ? 0.15 : 0.25);
	const bw = $derived(W / Math.max(1, days.length));
</script>

<figure class="chart">
	<div class="plot">
		<span class="max num">{formatMoneyCompact(max)}</span>
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Daily volume">
			<line x1="0" x2={W} y1={H - 0.25} y2={H - 0.25} class="base" />
			{#each days as d, i (d.day)}
				{@const h = d.volume > 0 ? Math.max(1.5, (d.volume / max) * (H - 4)) : 0}
				{@const tip = `${formatDate(d.day)} · ${formatMoney(d.volume)} · ${plural(d.count, 'payment', 'payments')}`}
				<g class="day">
					<title>{tip}</title>
					<rect class="hit" x={i * bw} y="0" width={bw} height={H} />
					<rect class="bar" x={(i + gap / 2) * bw} y={H - h} width={bw * (1 - gap)} height={h} />
				</g>
			{/each}
		</svg>
	</div>
	{#if days.length}
		<figcaption class="axis subtle">
			<span>{formatShortDate(days[0]!.day)}</span><span>{formatShortDate(days[days.length - 1]!.day)}</span>
		</figcaption>
	{/if}
</figure>

<style>
	.chart {
		margin: 0;
		padding: var(--space-4);
	}
	.plot {
		position: relative;
		height: 180px;
	}
	.max {
		position: absolute;
		top: -2px;
		left: 0;
		font-size: var(--text-xs);
		color: var(--fg-subtle);
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
		padding-top: 18px;
		overflow: visible;
	}
	.bar {
		fill: var(--accent);
	}
	.hit {
		fill: transparent;
	}
	.day:hover .hit {
		fill: var(--bg-muted);
	}
	.day:hover .bar {
		fill: var(--accent-hover);
	}
	.base {
		stroke: var(--border);
		stroke-width: 0.5;
		vector-effect: non-scaling-stroke;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-xs);
		margin-top: var(--space-2);
	}
</style>
