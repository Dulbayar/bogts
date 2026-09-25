<!-- Segmented count tiles above a list (Stripe style): All 128 · Paid 97 · … -->
<script lang="ts">
	import { formatCount } from '$lib/format';

	type Tile = { label: string; count: number | null; href: string; active: boolean };
	let { tiles, label }: { tiles: Tile[]; label: string } = $props();
</script>

<nav class="tiles" aria-label={label}>
	{#each tiles as tile (tile.label)}
		<a href={tile.href} class:active={tile.active} aria-current={tile.active ? 'page' : undefined}>
			<span class="label">{tile.label}</span>
			<span class="count">{tile.count === null ? '—' : formatCount(tile.count)}</span>
		</a>
	{/each}
</nav>

<style>
	.tiles {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
		overflow-x: auto;
		scrollbar-width: none;
		padding: 2px;
	}
	a {
		position: relative;
		flex: 1 0 auto;
		min-width: 104px;
		display: grid;
		gap: 2px;
		padding: var(--space-2) var(--space-3) 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg);
		box-shadow: var(--shadow-sm);
		color: var(--fg-muted);
		text-decoration: none;
		overflow: hidden;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}
	a::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		background: var(--accent);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform var(--dur-base) var(--ease);
	}
	a:hover {
		border-color: var(--border-strong);
	}
	a.active {
		border-color: var(--accent-border);
		background: color-mix(in srgb, var(--accent-subtle) 55%, var(--bg));
		color: var(--accent-text);
	}
	a.active::after {
		transform: scaleX(1);
	}
	.label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}
	.count {
		font-family: var(--font-display);
		font-size: 22px;
		line-height: 28px;
		font-weight: var(--weight-semibold);
		font-variant-numeric: lining-nums tabular-nums;
		color: var(--fg);
	}
	@media (max-width: 639px) {
		a {
			flex: 0 0 auto;
		}
	}
</style>
