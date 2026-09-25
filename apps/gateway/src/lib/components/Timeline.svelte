<!-- The merged per-subject timeline (ux-brief §7.3), newest first with an "Oldest first" toggle. -->
<script lang="ts">
	import type { TimelineEntry } from '$lib/server/admin/timeline';
	import { eventTypeTone } from '$lib/status';
	import DeliveryBadge from './DeliveryBadge.svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import Time from './Time.svelte';

	let { entries }: { entries: TimelineEntry[] } = $props();
	let oldestFirst = $state(false);
	const shown = $derived(oldestFirst ? [...entries].reverse() : entries);

	const ICON: Record<TimelineEntry['source'], IconName> = {
		gateway: 'dot',
		provider: 'arrowDown',
		event: 'arrowUp',
		admin: 'user'
	};
</script>

<section class="card">
	<header>
		<h2>Timeline</h2>
		{#if entries.length > 1}
			<button type="button" class="btn ghost sm" aria-pressed={oldestFirst} onclick={() => (oldestFirst = !oldestFirst)}>
				{oldestFirst ? 'Oldest first' : 'Newest first'}
			</button>
		{/if}
	</header>
	<ol class="timeline">
		{#each shown as e (e.key)}
			<li>
				<span class="dot {e.source} {e.eventType ? `tone-${eventTypeTone(e.eventType)}` : ''}"><Icon name={ICON[e.source]} size={12} /></span>
				<div class="what">
					<div class="title">
						{#if e.href}
							<a href={e.href} class:mono={!!e.eventType}>{e.title}</a>
						{:else}
							{e.title}
						{/if}
						{#if e.delivery}<DeliveryBadge delivery={e.delivery} detail />{/if}
					</div>
					{#if e.detail}<div class="detail subtle">{e.detail}</div>{/if}
				</div>
				<div class="when">
					<Time at={e.at} mode="detail" />
					<span class="subtle"><Time at={e.at} mode="relative" /></span>
				</div>
			</li>
		{/each}
	</ol>
</section>

<style>
	.timeline {
		list-style: none;
		margin: 0;
		padding: var(--space-2) var(--space-4);
	}
	li {
		position: relative;
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		gap: var(--space-3);
		padding: var(--space-3) 0;
	}
	li:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 9.5px;
		top: 32px;
		bottom: -8px;
		width: 1px;
		background: var(--border);
	}
	.dot {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--bg-muted);
		color: var(--fg-muted);
	}
	.dot.gateway {
		color: var(--accent);
		background: var(--accent-subtle);
	}
	.dot.tone-success {
		color: var(--success-fg);
		background: var(--success-bg);
	}
	.dot.tone-danger {
		color: var(--danger-fg);
		background: var(--danger-bg);
	}
	.title {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		font-size: var(--text-sm);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.title .mono {
		font-size: var(--text-sm);
	}
	.detail {
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}
	.when {
		display: grid;
		justify-items: end;
		font-size: var(--text-xs);
		color: var(--fg-muted);
	}
	@media (max-width: 639px) {
		li {
			grid-template-columns: 20px minmax(0, 1fr);
		}
		.when {
			grid-column: 2;
			justify-items: start;
			display: flex;
			gap: var(--space-2);
		}
	}
</style>
