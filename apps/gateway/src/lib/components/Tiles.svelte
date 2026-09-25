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
		flex: 1 0 auto;
		min-width: 96px;
		display: grid;
		gap: 2px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg);
		color: var(--fg-muted);
		text-decoration: none;
	}
	a:hover {
		border-color: var(--border-strong);
	}
	a.active {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
		color: var(--accent);
	}
	.label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}
	.count {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		font-variant-numeric: tabular-nums;
		color: var(--fg);
	}
	@media (max-width: 639px) {
		a {
			flex: 0 0 auto;
		}
	}
</style>
