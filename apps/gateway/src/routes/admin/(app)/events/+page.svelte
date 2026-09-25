<script lang="ts">
	import { page } from '$app/state';
	import DeliveryBadge from '$lib/components/DeliveryBadge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import EventType from '$lib/components/EventType.svelte';
	import IdChip from '$lib/components/IdChip.svelte';
	import Money from '$lib/components/Money.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import Tiles from '$lib/components/Tiles.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import { responseTone } from '$lib/delivery';
	import { withParams } from '$lib/url';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TILES = [
		{ key: null, label: 'All' },
		{ key: 'succeeded', label: 'Delivered' },
		{ key: 'retrying', label: 'Retrying' },
		{ key: 'failed', label: 'Failed' }
	] as const;
	const tiles = $derived(
		TILES.map((t) => ({
			label: t.label,
			count: data.counts[t.key ?? 'all'] ?? 0,
			href: withParams(page.url, { status: t.key, before: null, after: null }),
			active: (data.filter.state ?? null) === t.key
		}))
	);
	const showProject = $derived(!data.scope);
	const failingTile = $derived(data.filter.state === 'retrying' || data.filter.state === 'failed' || data.filter.state === 'failing');
	const caption = $derived(`Events, newest first${data.filter.state ? `, delivery ${data.filter.state}` : ''}`);
	const response = (d: { lastStatus: number | null; lastError: string | null } | null) =>
		d ? (d.lastStatus ? String(d.lastStatus) : d.lastError === 'no_webhook_url' ? null : d.lastError) : null;
</script>

<Title title="Events" />

<PageHeader title="Events" />

<Tiles {tiles} label="Filter by delivery" />

{#if data.page.rows.length === 0}
	{#if failingTile}
		<EmptyState icon="check" title="No failing deliveries" />
	{:else if data.filter.state}
		<EmptyState title="No events match these filters.">
			<a class="btn sm" href={withParams(page.url, { status: null, before: null, after: null })}>Clear filters</a>
		</EmptyState>
	{:else}
		<EmptyState icon="send" title="No events yet">Events appear here when a payment settles.</EmptyState>
	{/if}
{:else}
	<div class="table-wrap responsive">
		<table class="data">
			<caption class="sr-only">{caption}</caption>
			<thead>
				<tr>
					<th>Type</th>
					<th>Delivery</th>
					<th>Subject</th>
					<th class="right hide-md">Amount</th>
					<th class="hide-md">Last response</th>
					<th class="right hide-md">Next retry</th>
					{#if showProject}<th class="hide-md">Project</th>{/if}
					<th class="right">Created</th>
				</tr>
			</thead>
			<tbody>
				{#each data.page.rows as r (r.id)}
					{@const resp = response(r.delivery)}
					<tr>
						<td><a class="row-link" href="/admin/events/{r.id}"><EventType type={r.type} /></a></td>
						<td><DeliveryBadge delivery={r.delivery} detail /></td>
						<td><IdChip id={r.subjectId} href={r.subjectHref} /></td>
						<td class="right hide-md"><Money amount={r.amount} /></td>
						<td class="hide-md mono tone-{responseTone(r.delivery?.lastStatus, r.delivery?.lastError)}">{resp ?? '—'}</td>
						<td class="right muted hide-md"><Time at={r.delivery?.nextAttemptAt} mode="future" /></td>
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
				<a href="/admin/events/{r.id}">
					<span class="line"><EventType type={r.type} /><DeliveryBadge delivery={r.delivery} /></span>
					<span class="line mono subtle">{r.subjectId}</span>
					<span class="line subtle"><Time at={r.createdAt} /></span>
				</a>
			</li>
		{/each}
	</ul>
	<Pager newer={data.page.newer} older={data.page.older} />
{/if}
