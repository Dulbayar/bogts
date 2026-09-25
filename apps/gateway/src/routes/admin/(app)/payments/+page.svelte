<script lang="ts">
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Money from '$lib/components/Money.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import ProviderTag from '$lib/components/ProviderTag.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Tiles from '$lib/components/Tiles.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import { truncateEnd } from '$lib/format';
	import { invoiceStatus } from '$lib/status';
	import { withParams } from '$lib/url';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TILES = [
		{ key: null, label: 'All' },
		{ key: 'paid', label: 'Paid' },
		{ key: 'pending', label: 'Pending' },
		{ key: 'expired', label: 'Expired' },
		{ key: 'failed', label: 'Failed' }
	] as const;
	const tiles = $derived(
		TILES.map((t) => ({
			label: t.label,
			count: data.counts[t.key ?? 'all'] ?? 0,
			href: withParams(page.url, { status: t.key, before: null, after: null }),
			active: (data.filter.status ?? null) === t.key
		}))
	);
	const PROVIDERS = [
		{ key: null, label: 'All providers' },
		{ key: 'qpay', label: 'QPay' },
		{ key: 'bonum', label: 'Bonum' }
	] as const;
	const showProject = $derived(!data.scope);
	const sandbox = $derived(new Set(data.env.mode === 'mixed' ? data.env.sandbox.map((s) => s.toLowerCase()) : []));
	const filtered = $derived(!!data.filter.status || !!data.filter.provider || !!data.filter.reference);
	const caption = $derived(
		`Payments, newest first${data.filter.status ? `, status ${invoiceStatus(data.filter.status).label}` : ''}${data.filter.provider ? `, provider ${data.filter.provider}` : ''}${data.filter.reference ? `, reference ${data.filter.reference}` : ''}`
	);
</script>

<Title title="Payments" />

<PageHeader title="Payments">
	{#snippet actions()}
		<nav class="seg" aria-label="Provider">
			{#each PROVIDERS as p (p.label)}
				<a
					href={withParams(page.url, { provider: p.key, before: null, after: null })}
					aria-current={(data.filter.provider ?? null) === p.key ? 'true' : undefined}>{p.label}</a
				>
			{/each}
		</nav>
	{/snippet}
</PageHeader>

<Tiles {tiles} label="Filter by status" />

{#if data.filter.reference}
	<p class="reference-filter">
		Reference <code>{data.filter.reference}</code>
		<a class="btn sm" href={withParams(page.url, { reference: null, before: null, after: null })}>Show all references</a>
	</p>
{/if}

{#if data.page.rows.length === 0}
	{#if filtered}
		<EmptyState title="No payments match these filters.">
			<a class="btn sm" href={withParams(page.url, { status: null, provider: null, reference: null, before: null, after: null })}>Clear filters</a>
		</EmptyState>
	{:else}
		<EmptyState icon="receipt" title="No payments yet">Payments appear here when a project creates an invoice.</EmptyState>
	{/if}
{:else}
	<div class="table-wrap responsive">
		<table class="data">
			<caption class="sr-only">{caption}</caption>
			<thead>
				<tr>
					<th class="right">Amount</th>
					<th>Status</th>
					<th class="hide-md">Provider</th>
					<th>Reference</th>
					<th class="hide-md flex">Description</th>
					{#if showProject}<th class="hide-md">Project</th>{/if}
					<th class="right">Created</th>
					<th class="right hide-md">Paid / Expires</th>
				</tr>
			</thead>
			<tbody>
				{#each data.page.rows as r (r.id)}
					<tr>
						<td class="right"><a class="row-link" href="/admin/payments/{r.id}"><strong><Money amount={r.amount} /></strong></a></td>
						<td><StatusBadge status={invoiceStatus(r.status)} /></td>
						<td class="hide-md"><ProviderTag provider={r.provider} test={sandbox.has(r.provider)} /></td>
						<td class="mono" title={r.reference}>{truncateEnd(r.reference)}</td>
						<td class="hide-md muted" title={r.description}>{r.description}</td>
						{#if showProject}<td class="hide-md">{r.projectName}</td>{/if}
						<td class="right muted"><Time at={r.createdAt} /></td>
						<td class="right muted hide-md">
							{#if r.status === 'paid'}<Time at={r.paidAt} />{:else if r.status === 'pending'}expires <Time
									at={r.expiresAt}
									mode="future"
								/>{:else}—{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<ul class="rows" aria-label={caption}>
		{#each data.page.rows as r (r.id)}
			<li>
				<a href="/admin/payments/{r.id}">
					<span class="line"><strong><Money amount={r.amount} /></strong><StatusBadge status={invoiceStatus(r.status)} /></span>
					<span class="line mono">{truncateEnd(r.reference)}</span>
					<span class="line subtle"><Time at={r.createdAt} /></span>
				</a>
			</li>
		{/each}
	</ul>
	<Pager newer={data.page.newer} older={data.page.older} />
{/if}


<style>
	.reference-filter {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0 0 12px;
	}
</style>
