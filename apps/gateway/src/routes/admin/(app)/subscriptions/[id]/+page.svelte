<script lang="ts">
	import Callout from '$lib/components/Callout.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import IdChip from '$lib/components/IdChip.svelte';
	import Money from '$lib/components/Money.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Time from '$lib/components/Time.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import Title from '$lib/components/Title.svelte';
	import { formatCardExpiry, formatCardMask, formatDate, formatShortDate } from '$lib/format';
	import { chargeStatus, intervalUnit, subscriptionStatus } from '$lib/status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const sub = $derived(data.subscription);
	let confirmCancel = $state(false);
	const lastPayment = $derived(data.payments.find((p) => p.amount > 0) ?? null);
	const lastFailure = $derived(data.events.find((e) => e.type === 'subscription.payment_failed') ?? null);

	/** The card works through the end of its expiry month. */
	const cardExpiresBeforeBill = $derived.by(() => {
		const m = data.card?.expiry ? /^(\d{4})[/-](\d{1,2})$/.exec(data.card.expiry.trim()) : null;
		if (!m || !sub.nextBillAt || sub.status === 'cancelled') return false;
		return Date.UTC(Number(m[1]), Number(m[2]), 1) <= sub.nextBillAt;
	});
</script>

<Title title="Subscription {sub.customerRef}" />

<header class="detail-head">
	<div class="eyebrow">Subscription · <span class="tag">Bonum</span></div>
	<div class="title-row">
		<h1 class="text"><span class="mono">{sub.customerRef}</span>{#if sub.email}<span class="email"> ({sub.email})</span>{/if}</h1>
		<StatusBadge status={subscriptionStatus(sub.status)} />
		<span class="spacer"></span>
		<CopyButton value={sub.id} text="Copy id" label="Copy subscription id" />
		{#if sub.status !== 'cancelled'}
			<button type="button" class="btn danger-text" onclick={() => (confirmCancel = true)}>Cancel subscription…</button>
		{/if}
	</div>
	<p class="sub">
		<a class="mono" href="/admin/projects/{data.project.id}?tab=plans">{data.plan.key}</a> ·
		<Money amount={data.plan.amount} /> / {intervalUnit(data.plan.interval)} ·
		<a href="/admin/projects/{data.project.id}">{data.project.name}</a>
	</p>
</header>

<div class="detail">
	<div class="stack">
		{#if sub.status === 'past_due'}
			<Callout tone="warning">
				Last renewal failed{#if lastFailure}&nbsp;on {formatShortDate(lastFailure.createdAt)}{/if}. Bonum will retry; {data.project.name}
				was sent <code>subscription.payment_failed</code>.
			</Callout>
		{/if}
		<section class="card strip">
			{#if sub.status !== 'past_due'}
				<div class="stat">
					<span class="k">Next bill</span>
					{#if sub.nextBillAt && sub.status !== 'cancelled'}
						<span class="v">{formatDate(sub.nextBillAt)}</span>
						<span class="subtle"><Time at={sub.nextBillAt} mode="future" /></span>
					{:else}
						<span class="v subtle">—</span>
					{/if}
				</div>
			{/if}
			<div class="stat">
				<span class="k">Last payment</span>
				{#if lastPayment}
					<span class="v"><Money amount={lastPayment.amount} /> · {formatShortDate(lastPayment.createdAt)}</span>
				{:else}
					<span class="v subtle">—</span>
				{/if}
			</div>
			<div class="stat">
				<span class="k">Started</span>
				<span class="v">{formatDate(sub.createdAt)}</span>
			</div>
		</section>

		{#if data.payments.length || data.charges.length}
			<section class="card">
				<header><h2>Payments</h2></header>
				<table class="data">
					<caption class="sr-only">Payments for this subscription, newest first</caption>
					<thead><tr><th class="right">Amount</th><th>Kind</th><th class="flex">Bonum ref</th><th class="right">Time</th></tr></thead>
					<tbody>
						{#each data.payments as p, i (p.id)}
							<tr>
								<td class="right"><Money amount={p.amount} /></td>
								<td>{p.amount < 0 ? 'Reversal' : i === data.payments.length - 1 ? 'First payment' : 'Renewal'}</td>
								<td class="mono muted" title={p.providerRef}>{p.providerRef}</td>
								<td class="right muted"><Time at={p.createdAt} /></td>
							</tr>
						{/each}
						{#each data.charges as c (c.id)}
							<tr>
								<td class="right"><a class="row-link" href="/admin/charges/{c.id}"><Money amount={c.amount} struck={c.status === 'reversed'} /></a></td>
								<td><StatusBadge status={chargeStatus(c.status)} /></td>
								<td class="mono muted" title={c.reference}>charge · {c.reference}</td>
								<td class="right muted"><Time at={c.createdAt} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<Timeline entries={data.timeline} />
	</div>

	<aside class="stack">
		<section class="card">
			<header><h2>Card on file</h2></header>
			{#if data.card}
				<dl class="kv">
					<div><dt>Card</dt><dd class="mono">{formatCardMask(data.card.mask)}</dd></div>
					{#if data.card.bankName}<div><dt>Bank</dt><dd>{data.card.bankName}</dd></div>{/if}
					{#if data.card.expiry}
						<div>
							<dt>Expires</dt>
							<dd>
								{formatCardExpiry(data.card.expiry)}
								{#if cardExpiresBeforeBill}<span class="tag test">Expires before next bill</span>{/if}
							</dd>
						</div>
					{/if}
				</dl>
			{:else}
				<div class="body subtle">No card yet</div>
			{/if}
		</section>
		{#if data.cardHistory.length > 1}
			<section class="card">
				<header><h2>Card history</h2></header>
				<ul class="history">
					{#each data.cardHistory as c (c.id)}
						<li>
							<span class="mono">{formatCardMask(c.mask)}</span>
							<span class="subtle">
								{#if c.current}since {formatShortDate(c.createdAt)}{:else}{formatShortDate(c.createdAt)}{#if c.removedAt}&nbsp;– {formatShortDate(c.removedAt)}{/if} (replaced){/if}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		<section class="card">
			<header><h2>Details</h2></header>
			<dl class="kv">
				<div><dt>Subscription id</dt><dd><IdChip id={sub.id} full /></dd></div>
				{#if sub.providerSubscriptionId}<div><dt>Bonum subscription id</dt><dd><IdChip id={sub.providerSubscriptionId} /></dd></div>{/if}
				<div><dt>Plan</dt><dd><a class="mono" href="/admin/projects/{data.project.id}?tab=plans">{data.plan.key}</a></dd></div>
				{#if sub.nextPlanKey && sub.nextBillAt}<div><dt>Next plan</dt><dd><span class="mono">{sub.nextPlanKey}</span> from {formatDate(sub.nextBillAt)}</dd></div>{/if}
				{#if sub.retiringProviderSubscriptionId}<div><dt>Replaced Bonum id</dt><dd><IdChip id={sub.retiringProviderSubscriptionId} /> <span class="subtle">still to delete</span></dd></div>{/if}
				<div><dt>Project</dt><dd><a href="/admin/projects/{data.project.id}">{data.project.name}</a></dd></div>
				<div><dt>Customer ref</dt><dd><span class="mono">{sub.customerRef}</span><CopyButton value={sub.customerRef} label="Copy customer ref" /></dd></div>
				<div><dt>Email</dt><dd>{#if sub.email}{sub.email}{:else}<span class="subtle">—</span>{/if}</dd></div>
				{#if sub.cancelledAt}<div><dt>Cancelled</dt><dd><Time at={sub.cancelledAt} mode="detail" /></dd></div>{/if}
			</dl>
		</section>
	</aside>
</div>

<ConfirmDialog
	bind:open={confirmCancel}
	title="Cancel subscription"
	action="?/cancel"
	expected={sub.customerRef}
	confirmLabel="Cancel subscription"
	cancelLabel="Keep subscription"
	busyLabel="Cancelling…"
	successMessage="Subscription cancelled"
>
	<p>
		This stops future renewals for <span class="mono">{sub.customerRef}</span> on Bonum. {data.project.name} will receive
		<code>subscription.cancelled</code>. Can't be undone.
	</p>
</ConfirmDialog>

<style>
	.email {
		color: var(--fg-muted);
		font-weight: var(--weight-regular);
		font-size: var(--text-lg);
	}
	.strip {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	}
	.stat {
		display: grid;
		gap: 2px;
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
	}
	.stat + .stat {
		border-left: 1px solid var(--border);
	}
	.k {
		font-size: var(--text-xs);
		color: var(--fg-muted);
	}
	.v {
		font-weight: var(--weight-medium);
	}
	.history {
		list-style: none;
		margin: 0;
		padding: var(--space-3) var(--space-4);
		display: grid;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.history li {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	@media (max-width: 479px) {
		.stat + .stat {
			border-left: 0;
			border-top: 1px solid var(--border);
		}
	}
</style>
