<script lang="ts">
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Title from '$lib/components/Title.svelte';
	import { addMonths, formatCount, formatMonth } from '$lib/format';
	import { withParams } from '$lib/url';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const prev = $derived(addMonths(data.month, -1));
	const next = $derived(addMonths(data.month, 1));
	const hasNext = $derived(next <= data.current);
</script>

<Title title="Usage" />

<PageHeader title="Usage">
	{#snippet actions()}
		<nav class="month" aria-label="Month">
			<a class="btn ghost sm" href={withParams(page.url, { month: prev })} aria-label="Previous month"><Icon name="chevronLeft" /></a>
			<span class="label">{formatMonth(data.month)}</span>
			{#if hasNext}
				<a class="btn ghost sm" href={withParams(page.url, { month: next === data.current ? null : next })} aria-label="Next month"
					><Icon name="chevronRight" /></a
				>
			{:else}
				<span class="btn ghost sm" aria-disabled="true"><Icon name="chevronRight" /></span>
			{/if}
		</nav>
	{/snippet}
</PageHeader>

{#if data.lines.length === 0}
	<EmptyState icon="chart" title="No payments in {formatMonth(data.month)}" />
{:else}
	<div class="table-wrap responsive">
		<table class="data">
			<caption class="sr-only">Usage per project, {formatMonth(data.month)}</caption>
			<thead>
				<tr>
					<th class="flex">Project</th>
					<th class="right">Payments</th>
					<th class="right">Volume</th>
					<th class="right">Invoices</th>
					<th class="right">Renewals</th>
					<th class="right">Charges</th>
					<th class="right">Events</th>
				</tr>
			</thead>
			<tbody>
				{#each data.lines as l (l.projectId)}
					<tr>
						<td><a href="/admin/projects/{l.projectId}">{l.name}</a></td>
						<td class="right num">{formatCount(l.payments)}</td>
						<td class="right"><Money amount={l.volume} /></td>
						<td class="right num">{formatCount(l.invoices)}</td>
						<td class="right num">{formatCount(l.renewals)}</td>
						<td class="right num">{formatCount(l.charges)}</td>
						<td class="right num">{formatCount(l.events)}</td>
					</tr>
				{/each}
			</tbody>
			{#if data.lines.length > 1}
				<tfoot>
					<tr>
						<td>Total</td>
						<td class="right num">{formatCount(data.total.payments)}</td>
						<td class="right"><Money amount={data.total.volume} /></td>
						<td class="right num">{formatCount(data.total.invoices)}</td>
						<td class="right num">{formatCount(data.total.renewals)}</td>
						<td class="right num">{formatCount(data.total.charges)}</td>
						<td class="right num">{formatCount(data.total.events)}</td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
	<ul class="rows" aria-label="Usage per project">
		{#each data.lines as l (l.projectId)}
			<li>
				<a href="/admin/projects/{l.projectId}">
					<span class="line"><strong>{l.name}</strong><Money amount={l.volume} /></span>
					<span class="line subtle"
						>{formatCount(l.payments)} payments · {formatCount(l.renewals)} renewals · {formatCount(l.events)} events</span
					>
				</a>
			</li>
		{/each}
		{#if data.lines.length > 1}
			<li class="total">
				<span class="line"><strong>Total</strong><strong><Money amount={data.total.volume} /></strong></span>
			</li>
		{/if}
	</ul>
{/if}

<style>
	.month {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.label {
		min-width: 128px;
		text-align: center;
		font-weight: var(--weight-medium);
		font-size: var(--text-sm);
	}
	.total {
		padding: var(--space-3) var(--space-4);
		background: var(--bg-subtle);
	}
	tfoot td {
		position: sticky;
		bottom: 0;
		height: var(--row-h);
		padding: 0 var(--space-3);
		background: var(--bg-subtle);
		border-top: 1px solid var(--border);
		font-weight: var(--weight-semibold);
	}
</style>
