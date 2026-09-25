<!--
	The project scope (ux-brief §9.5). Keeps the current page and swaps
	`?project=`; from a detail page it jumps to that section's list.
-->
<script lang="ts">
	import { page } from '$app/state';
	import type { ProjectOption } from '$lib/server/admin/projects';
	import { withParams } from '$lib/url';
	import Icon from './Icon.svelte';

	let { projects, scope }: { projects: ProjectOption[]; scope: string | null } = $props();

	let details: HTMLDetailsElement | undefined = $state();
	let filter = $state('');
	const current = $derived(projects.find((p) => p.id === scope) ?? null);
	const shown = $derived(
		projects.filter((p) => !p.archived || p.id === scope).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()))
	);

	/** The list path for the current section (detail pages jump to their list). */
	const listPath = $derived.by(() => {
		const parts = page.url.pathname.split('/').filter(Boolean);
		const section = parts[1];
		if (!section || ['projects', 'settings', 'search'].includes(section)) return '/admin';
		return `/admin/${section}`;
	});

	function href(id: string | null) {
		const onList = page.url.pathname === listPath;
		return withParams(onList ? page.url : new URL(listPath, page.url), { project: id, before: null, after: null }, listPath);
	}

	function close() {
		if (details) details.open = false;
		filter = '';
	}
</script>

<details class="switcher" bind:this={details}>
	<summary>
		<span class="name">{current ? current.name : 'All projects'}</span>
		<Icon name="chevronDown" size={14} />
	</summary>
	<div class="menu">
		{#if projects.length > 6}
			<input class="input" placeholder="Filter projects" aria-label="Filter projects" bind:value={filter} />
		{/if}
		<ul>
			<li><a href={href(null)} aria-current={scope === null ? 'true' : undefined} onclick={close}>All projects</a></li>
			{#each shown as p (p.id)}
				<li>
					<a href={href(p.id)} aria-current={scope === p.id ? 'true' : undefined} onclick={close}>
						<span class="dot" class:bad={p.failing} aria-hidden="true"></span>
						<span class="pname">{p.name}</span>
						{#if p.failing}<span class="sr-only">(deliveries failing)</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	</div>
</details>

<style>
	.switcher {
		position: relative;
	}
	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		height: var(--control-h);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.menu {
		position: absolute;
		z-index: 45;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		display: grid;
		gap: var(--space-1);
		padding: var(--space-1);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		max-height: 320px;
		overflow-y: auto;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	a {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		height: 32px;
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--fg);
		font-size: var(--text-sm);
		text-decoration: none;
	}
	a:hover {
		background: var(--bg-muted);
	}
	a[aria-current] {
		font-weight: var(--weight-semibold);
	}
	.pname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success-fg);
	}
	.dot.bad {
		background: var(--danger-fg);
	}
</style>
