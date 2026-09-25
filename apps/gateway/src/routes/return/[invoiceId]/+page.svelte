<!--
	Where the payer lands after Bonum's hosted checkout (ux-brief §14.2). The
	outcome is our own stored status, never a query param; the only redirect
	target is the invoice's stored return URL.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { pollStatus, type PolledStatus } from '$lib/checkout';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const inv = $derived(data.invoice);

	let polled = $state<string | null>(null);
	let slow = $state(false);
	const status = $derived(polled ?? inv.status);

	function onStatus(s: PolledStatus) {
		polled = s;
		if (s === 'paid' && inv.returnUrl) {
			const target = inv.returnUrl;
			setTimeout(() => window.location.assign(target), 2000);
		}
	}

	onMount(() => {
		if (status === 'paid' && inv.returnUrl) {
			const target = inv.returnUrl;
			const t = setTimeout(() => window.location.assign(target), 2000);
			return () => clearTimeout(t);
		}
		if (status !== 'pending') return;
		const poller = pollStatus(inv.id, { until: Date.now() + 30_000, onStatus, onGiveUp: () => (slow = true) });
		return () => poller.stop();
	});
</script>

<svelte:head>
	<title>{status === 'paid' ? 'Payment complete' : 'Payment'} · {inv.projectName}</title>
	<meta name="robots" content="noindex" />
	{#if status === 'paid' && inv.returnUrl}
		<meta http-equiv="refresh" content="2;url={inv.returnUrl}" />
	{:else if status === 'pending'}
		<noscript><meta http-equiv="refresh" content="5" /></noscript>
	{/if}
</svelte:head>

<PublicShell sandbox={data.sandbox}>
	<section class="state" role="status">
		{#if status === 'paid'}
			<span class="icon ok"><Icon name="check" size={28} /></span>
			<h1>Payment complete</h1>
			<p class="muted"><Money amount={inv.amount} /> to {inv.projectName}</p>
			{#if inv.returnUrl}
				<p class="muted row"><span class="spinner" aria-hidden="true"></span> Returning you to {inv.projectName}…</p>
				<a class="btn lg block" href={inv.returnUrl}>Return now</a>
			{/if}
		{:else if status === 'pending'}
			{#if slow}
				<span class="icon"><Icon name="clock" size={28} /></span>
				<h1>This is taking longer than usual</h1>
				<p class="muted">You can safely return. {inv.projectName} will be notified when it completes.</p>
			{:else}
				<span class="icon"><span class="spinner big" aria-hidden="true"></span></span>
				<h1>Confirming your payment…</h1>
				<p class="muted"><Money amount={inv.amount} /> to {inv.projectName}</p>
			{/if}
			{#if inv.returnUrl && slow}<a class="btn lg block" href={inv.returnUrl}>Return to {inv.projectName}</a>{/if}
		{:else}
			<span class="icon bad"><Icon name="x" size={28} /></span>
			<h1>Payment didn't go through</h1>
			{#if status === 'expired'}<p class="muted">The payment link expired.</p>{/if}
			{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl}>Return to {inv.projectName}</a>{/if}
		{/if}
	</section>
</PublicShell>

<style>
	.state {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		text-align: center;
		margin-top: var(--space-8);
	}
	h1 {
		font-size: var(--text-xl);
		line-height: var(--lh-xl);
		font-weight: var(--weight-semibold);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--bg-muted);
		color: var(--fg-muted);
	}
	.icon.ok {
		background: var(--success-bg);
		color: var(--success-fg);
	}
	.icon.bad {
		background: var(--danger-bg);
		color: var(--danger-fg);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.btn.lg {
		height: 44px;
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border-strong);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.spinner.big {
		width: 24px;
		height: 24px;
		border-width: 3px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
