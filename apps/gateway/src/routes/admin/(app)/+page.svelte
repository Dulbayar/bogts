<script lang="ts">
	import { page } from '$app/state';
	import DeliveryBadge from '$lib/components/DeliveryBadge.svelte';
	import EventType from '$lib/components/EventType.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import VolumeChart from '$lib/components/VolumeChart.svelte';
	import { formatCount, formatMoney, formatMoneyCompact, hostOf, moneyLabel, truncateMiddle } from '$lib/format';
	import { scopedHref, withParams } from '$lib/url';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const PERIODS = ['7d', '30d', '90d'] as const;
	const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
	const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(0)}%`;
	const hasProviders = $derived(data.setup?.providers ?? false);
</script>

<Title title="Overview" />

<PageHeader title="Overview">
	{#snippet actions()}
		{#if !data.setup}
			<nav class="seg" aria-label="Period">
				{#each PERIODS as p (p)}
					<a href={withParams(page.url, { period: p === '30d' ? null : p })} aria-current={data.period === p ? 'true' : undefined}>{p}</a>
				{/each}
			</nav>
		{/if}
	{/snippet}
</PageHeader>

{#if data.setup}
	<section class="card setup">
		<header><h2>Set up Bogts</h2></header>
		<ol>
			<li class:done={hasProviders}>
				<span class="mark" aria-hidden="true">{#if hasProviders}<Icon name="check" size={14} />{/if}</span>
				<a href="/admin/settings">Configure a provider</a>
				<span class="sr-only">{hasProviders ? 'done' : 'to do'}</span>
			</li>
			<li><span class="mark" aria-hidden="true"></span><a href="/admin/projects/new">Create a project</a></li>
			<li><span class="mark" aria-hidden="true"></span><span>Set its webhook URL</span></li>
			<li><span class="mark" aria-hidden="true"></span><span>Add a plan, if it sells subscriptions</span></li>
			<li><span class="mark" aria-hidden="true"></span><span>Make a test payment in sandbox</span></li>
		</ol>
	</section>
{:else}
	{#if data.attention.length}
		<section class="card attention" aria-label="Needs attention">
			<ul>
				{#each data.attention as item, i (i)}
					<li class={item.tone}>
						<Icon name={item.tone === 'danger' ? 'x' : 'alert'} size={14} />
						<span class="text"><RichText text={item.text} /></span>
						{#if item.href}<a href={item.href}>View →</a>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="calm"><Icon name="check" size={14} /> Nothing needs attention</p>
	{/if}

	{#if data.kpis}
		{@const k = data.kpis}
		<div class="kpis">
			<div class="card kpi">
				<span class="label">Volume</span>
				<span class="value" title={formatMoney(k.volume)} aria-label={moneyLabel(k.volume)}>{formatMoneyCompact(k.volume)}</span>
				{#if k.volumeDelta !== null}<span class="foot">{signed(k.volumeDelta)} vs previous {data.period}</span>{/if}
			</div>
			<div class="card kpi">
				<span class="label">Payments</span>
				<span class="value">{formatCount(k.payments)}</span>
			</div>
			<div class="card kpi">
				<span class="label">Success rate</span>
				{#if k.successRate !== null}
					<span class="value" title="Paid ÷ (paid + failed + expired), invoices and charges created in the period. Pending is excluded."
						>{pct(k.successRate)}</span
					>
				{:else}
					<span class="value subtle" title="Shown from 20 finished payments">—</span>
				{/if}
			</div>
			<div class="card kpi">
				<span class="label">Active subscriptions</span>
				<span class="value">{formatCount(k.activeSubscriptions)}</span>
				{#if k.subscriptionsStarted || k.subscriptionsEnded}
					<span class="foot">+{k.subscriptionsStarted} / −{k.subscriptionsEnded} this period</span>
				{/if}
			</div>
		</div>
	{/if}

	<section class="card">
		<header><h2>Volume</h2></header>
		<VolumeChart days={data.daily} />
	</section>

	<div class="cols">
		<section class="card">
			<header>
				<h2>Recent events</h2>
				<a href={scopedHref('/admin/events', data.scope)} class="small">View all →</a>
			</header>
			{#if data.recent.length === 0}
				<p class="body subtle">No events yet.</p>
			{:else}
				<ul class="recent">
					{#each data.recent as e (e.id)}
						<li>
							<a href="/admin/events/{e.id}" class="ev"><EventType type={e.type} /></a>
							<span class="mono subtle subj">{truncateMiddle(e.subjectId)}</span>
							<span class="amt num">{#if e.amount !== null}<Money amount={e.amount} />{/if}</span>
							<span class="st"><DeliveryBadge delivery={e.delivery} /></span>
							<span class="when subtle"><Time at={e.createdAt} /></span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
		<section class="card">
			<header><h2>Delivery health · 7 days</h2></header>
			{#if data.health.length === 0}
				<p class="body subtle">No projects.</p>
			{:else}
				<ul class="health">
					{#each data.health as h (h.id)}
						<li>
							<a href="/admin/projects/{h.id}?tab=webhook" class="pname">{h.name}</a>
							{#if !h.webhookUrl}
								<span class="tone-warning small">No webhook URL</span>
							{:else if h.failing > 0}
								<span class="tone-danger small">{h.failing} failing{#if h.lastFailureAt}&nbsp;·&nbsp;<Time at={h.lastFailureAt} />{/if}</span>
							{:else}
								<span class="tone-success small"><Icon name="check" size={12} /> {hostOf(h.webhookUrl)}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
{/if}

<style>
	.calm {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--fg-muted);
		font-size: var(--text-sm);
		margin-bottom: var(--space-4);
	}
	.calm :global(.icon) {
		display: grid;
		place-items: center;
		color: var(--success-fg);
	}
	.attention {
		margin-bottom: var(--space-4);
	}
	.attention ul,
	.recent,
	.health,
	.setup ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.attention li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
	}
	.attention li + li,
	.recent li + li,
	.health li + li {
		border-top: 1px solid var(--border);
	}
	.attention li.danger :global(.icon) {
		color: var(--danger-fg);
	}
	.attention li.warning :global(.icon) {
		color: var(--warning-fg);
	}
	.attention .text {
		flex: 1;
		min-width: 0;
	}
	.attention a {
		white-space: nowrap;
	}
	.kpis {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.kpi {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-4);
		align-content: start;
	}
	.kpi .label {
		font-size: var(--text-xs);
		color: var(--fg-muted);
	}
	.kpi .value {
		font-family: var(--font-display);
		font-size: 32px;
		line-height: 40px;
		font-weight: var(--weight-semibold);
		font-variant-numeric: lining-nums tabular-nums;
		letter-spacing: -0.015em;
	}
	.kpi:first-child {
		background:
			linear-gradient(160deg, color-mix(in srgb, var(--accent-subtle) 90%, transparent), transparent 70%),
			var(--bg);
		border-color: var(--accent-border);
	}
	.kpi .foot {
		font-size: var(--text-xs);
		color: var(--fg-muted);
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		gap: var(--space-4);
		margin-top: var(--space-4);
	}
	.small {
		font-size: var(--text-sm);
	}
	.recent li {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 96px 112px 104px;
		align-items: center;
		gap: var(--space-3);
		padding: 0 var(--space-4);
		min-height: var(--row-h);
		font-size: var(--text-sm);
	}
	.recent .ev,
	.recent .subj {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recent .subj {
		font-size: var(--text-xs);
	}
	.recent .amt {
		text-align: right;
	}
	.recent .when {
		font-size: var(--text-xs);
		text-align: right;
		min-width: 72px;
	}
	.health li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
	}
	.health .pname {
		color: var(--fg);
		font-weight: var(--weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.health span {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.setup ol {
		padding: var(--space-2) var(--space-4);
	}
	.setup li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 40px;
		font-size: var(--text-sm);
	}
	.mark {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
		flex: none;
	}
	.done .mark {
		border-color: var(--success-fg);
		background: var(--success-bg);
		color: var(--success-fg);
	}
	@media (max-width: 1099px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 959px) {
		.kpis {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 639px) {
		.recent li {
			grid-template-columns: minmax(0, 1fr) auto;
			padding: var(--space-2) var(--space-4);
			row-gap: 2px;
		}
		.recent .subj,
		.recent .amt {
			display: none;
		}
		.recent .when {
			grid-column: 1;
			text-align: left;
		}
		.kpi .value {
			font-size: var(--text-xl);
		}
	}
	@media (max-width: 359px) {
		.kpis {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
