<script lang="ts">
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import { hostOf, maskedKey } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Only a real base gets a percentage, and only in the tooltip. */
	const healthTitle = (h: { total: number; delivered: number }) =>
		h.total >= 20 ? `${((h.delivered / h.total) * 100).toFixed(1)}% delivered in 7 days` : undefined;
</script>

<Title title="Projects" />

<PageHeader title="Projects">
	{#snippet actions()}
		<a class="btn primary" href="/admin/projects/new"><Icon name="plus" size={14} />New project</a>
	{/snippet}
</PageHeader>

{#if data.list.length === 0}
	<EmptyState icon="folder" title="No projects yet">
		<a class="btn sm primary" href="/admin/projects/new">New project</a>
	</EmptyState>
{:else}
	<div class="table-wrap responsive">
		<table class="data">
			<caption class="sr-only">Projects, newest first</caption>
			<thead>
				<tr>
					<th class="flex">Name</th>
					<th class="hide-md">API key</th>
					<th>Webhook</th>
					<th>Deliveries</th>
					<th class="hide-md">Plans</th>
					<th class="right hide-md">Created</th>
				</tr>
			</thead>
			<tbody>
				{#each data.list as p (p.id)}
					<tr>
						<td>
							<a class="row-link" href="/admin/projects/{p.id}"><strong>{p.name}</strong></a>
							<span class="subtle">{p.slug}</span>
							{#if p.archived}<span class="tag">Archived</span>{/if}
						</td>
						<td class="hide-md mono muted">{maskedKey(p.apiKeyPrefix)}</td>
						<td>
							{#if p.webhookUrl}{hostOf(p.webhookUrl)}{:else}<span class="tone-warning">Not set</span>{/if}
						</td>
						<td title={healthTitle(p.health)}>
							{#if p.health.failing > 0}<span class="tone-danger">{p.health.failing} failing</span>{:else}<span class="subtle">OK</span>{/if}
						</td>
						<td class="hide-md">
							{p.planCount}{#if p.planMismatch}<span class="mismatch" title="A plan doesn't match Bonum" aria-label="plan mismatch"></span>{/if}
						</td>
						<td class="right muted hide-md"><Time at={p.createdAt} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<ul class="rows" aria-label="Projects">
		{#each data.list as p (p.id)}
			<li>
				<a href="/admin/projects/{p.id}">
					<span class="line"
						><strong>{p.name}</strong>{#if p.health.failing > 0}<span class="tone-danger">{p.health.failing} failing</span>{:else if p.archived}<span
								class="tag">Archived</span
							>{/if}</span
					>
					<span class="line subtle">{p.webhookUrl ? hostOf(p.webhookUrl) : 'No webhook URL'}</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.mismatch {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-left: 6px;
		border-radius: 50%;
		background: var(--danger-fg);
		vertical-align: middle;
	}
	td .subtle {
		margin-left: 6px;
		font-size: var(--text-xs);
	}
	td .tag {
		margin-left: 6px;
	}
</style>
