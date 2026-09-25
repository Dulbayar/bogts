<script lang="ts">
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Money from '$lib/components/Money.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Tiles from '$lib/components/Tiles.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import { formatCardMask, truncateEnd } from '$lib/format';
	import { intervalUnit, subscriptionStatus } from '$lib/status';
	import { withParams } from '$lib/url';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TILES = [
		{ key: null, label: 'All' },
		{ key: 'active', label: 'Active' },
		{ key: 'past_due', label: 'Payment failed' },
		{ key: 'pending', label: 'Awaiting card' },
		{ key: 'cancelled', label: 'Cancelled' }
	] as const;
	const tiles = $derived(
		TILES.map((t) => ({
			label: t.label,
			count: data.counts[t.key ?? 'all'] ?? 0,
			href: withParams(page.url, { status: t.key, before: null, after: null }),
			active: (data.filter.status ?? null) === t.key
		}))
	);
	const showProject = $derived(!data.scope);
	const caption = $derived(
		`Subscriptions, newest first${data.filter.status ? `, status ${subscriptionStatus(data.filter.status).label}` : ''}`
	);
</script>

<Title title="Subscriptions" />

<PageHeader title="Subscriptions" />

<Tiles {tiles} label="Filter by status" />

{#if data.page.rows.length === 0}
	{#if data.filter.status}
		<EmptyState title="No subscriptions match these filters.">
			<a class="btn sm" href={withParams(page.url, { status: null, before: null, after: null })}>Clear filters</a>
		</EmptyState>
	{:else}
		<EmptyState icon="repeat" title="No subscriptions yet">Subscriptions appear here when a project starts one.</EmptyState>
	{/if}
{:else}
	<div class="table-wrap responsive">
		<table class="data">
			<caption class="sr-only">{caption}</caption>
			<thead>
				<tr>
					<th class="flex">Customer</th>
					<th>Status</th>
					<th>Plan</th>
					<th class="hide-md">Card</th>
					<th class="right">Next bill</th>
					{#if showProject}<th class="hide-md">Project</th>{/if}
					<th class="right hide-md">Started</th>
				</tr>
			</thead>
			<tbody>
				{#each data.page.rows as r (r.id)}
					<tr>
						<td>
							<a class="row-link mono" href="/admin/subscriptions/{r.id}" title={r.customerRef}>{truncateEnd(r.customerRef)}</a>
							{#if r.email}<span class="subtle email">{r.email}</span>{/if}
						</td>
						<td><StatusBadge status={subscriptionStatus(r.status)} /></td>
						<td>
							<span class="mono">{r.planKey}</span>
							<span class="subtle"><Money amount={r.planAmount} /> / {intervalUnit(r.planInterval)}</span>
						</td>
						<td class="hide-md mono">{formatCardMask(r.cardMask)}</td>
						<td class="right muted">
							{#if r.status === 'cancelled'}—{:else}<Time at={r.nextBillAt} mode="future" />{/if}
						</td>
						{#if showProject}<td class="hide-md">{r.projectName}</td>{/if}
						<td class="right muted hide-md"><Time at={r.createdAt} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<ul class="rows" aria-label={caption}>
		{#each data.page.rows as r (r.id)}
			<li>
				<a href="/admin/subscriptions/{r.id}">
					<span class="line"><span class="mono">{truncateEnd(r.customerRef)}</span><StatusBadge status={subscriptionStatus(r.status)} /></span>
					<span class="line"><span><span class="mono">{r.planKey}</span> <span class="subtle"><Money amount={r.planAmount} /> / {intervalUnit(r.planInterval)}</span></span></span>
					<span class="line subtle">
						{#if r.status === 'cancelled'}Cancelled{:else}Next bill <Time at={r.nextBillAt} mode="future" />{/if}
					</span>
				</a>
			</li>
		{/each}
	</ul>
	<Pager newer={data.page.newer} older={data.page.older} />
{/if}

<style>
	.email {
		margin-left: var(--space-2);
		font-size: var(--text-xs);
	}
</style>
