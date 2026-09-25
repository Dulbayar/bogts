<script lang="ts">
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IdChip from '$lib/components/IdChip.svelte';
	import Money from '$lib/components/Money.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Tiles from '$lib/components/Tiles.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import { formatCardMask, truncateEnd } from '$lib/format';
	import { chargeStatus } from '$lib/status';
	import { withParams } from '$lib/url';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TILES = [
		{ key: null, label: 'All' },
		{ key: 'succeeded', label: 'Succeeded' },
		{ key: 'pending', label: 'Processing' },
		{ key: 'failed', label: 'Failed' },
		{ key: 'reversed', label: 'Reversed' }
	] as const;
	const current = $derived(data.filter.status === 'queued' ? 'pending' : (data.filter.status ?? null));
	const tiles = $derived(
		TILES.map((t) => ({
			label: t.label,
			count: data.counts[t.key ?? 'all'] ?? 0,
			href: withParams(page.url, { status: t.key, before: null, after: null }),
			active: current === t.key
		}))
	);
	const showProject = $derived(!data.scope);
	const caption = $derived(
		`Charges, newest first${data.filter.status ? `, status ${chargeStatus(data.filter.status).label}` : ''}`
	);
</script>

<Title title="Charges" />

<PageHeader title="Charges" />

<Tiles {tiles} label="Filter by status" />

{#if data.page.rows.length === 0}
	{#if data.filter.status}
		<EmptyState title="No charges match these filters.">
			<a class="btn sm" href={withParams(page.url, { status: null, before: null, after: null })}>Clear filters</a>
		</EmptyState>
	{:else}
		<EmptyState icon="card" title="No charges yet">Charges appear here when a project charges a saved card.</EmptyState>
	{/if}
{:else}
	<div class="table-wrap responsive">
		<table class="data">
			<caption class="sr-only">{caption}</caption>
			<thead>
				<tr>
					<th class="right">Amount</th>
					<th>Status</th>
					<th class="flex">Reference</th>
					<th class="hide-md">Card</th>
					<th class="hide-md">Subscription</th>
					{#if showProject}<th class="hide-md">Project</th>{/if}
					<th class="right">Created</th>
				</tr>
			</thead>
			<tbody>
				{#each data.page.rows as r (r.id)}
					<tr>
						<td class="right">
							<a class="row-link" href="/admin/charges/{r.id}"><strong><Money amount={r.amount} struck={r.status === 'reversed'} /></strong></a>
						</td>
						<td><StatusBadge status={chargeStatus(r.status)} /></td>
						<td class="mono" title={r.reference}>{truncateEnd(r.reference)}</td>
						<td class="hide-md mono">{formatCardMask(r.cardMask)}</td>
						<td class="hide-md">
							{#if r.subscriptionId}<IdChip id={r.subscriptionId} href="/admin/subscriptions/{r.subscriptionId}" />{:else}<span class="subtle">—</span>{/if}
						</td>
						{#if showProject}<td class="hide-md">{r.projectName}</td>{/if}
						<td class="right muted"><Time at={r.createdAt} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<ul class="rows" aria-label={caption}>
		{#each data.page.rows as r (r.id)}
			<li>
				<a href="/admin/charges/{r.id}">
					<span class="line"><strong><Money amount={r.amount} struck={r.status === 'reversed'} /></strong><StatusBadge status={chargeStatus(r.status)} /></span>
					<span class="line mono">{truncateEnd(r.reference)}</span>
					<span class="line subtle"><Time at={r.createdAt} /></span>
				</a>
			</li>
		{/each}
	</ul>
	<Pager newer={data.page.newer} older={data.page.older} />
{/if}
