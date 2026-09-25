<!-- Underline tabs for the sub-views of a detail page; each tab is a link (`?tab=`). -->
<script lang="ts">
	let { tabs, label }: { tabs: { label: string; href: string; active: boolean }[]; label: string } = $props();
</script>

<nav class="tabs" aria-label={label}>
	{#each tabs as tab (tab.label)}
		<a href={tab.href} class:active={tab.active} aria-current={tab.active ? 'page' : undefined}>{tab.label}</a>
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		gap: var(--space-4);
		border-bottom: 1px solid var(--border);
		margin-bottom: var(--space-5);
		overflow-x: auto;
		scrollbar-width: none;
	}
	a {
		padding: var(--space-2) 0;
		margin-bottom: -1px;
		border-bottom: 2px solid transparent;
		color: var(--fg-muted);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}
	a:hover {
		color: var(--fg);
		text-decoration: none;
	}
	a.active {
		color: var(--fg);
		border-bottom-color: var(--accent);
	}
	a {
		transition:
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
</style>
