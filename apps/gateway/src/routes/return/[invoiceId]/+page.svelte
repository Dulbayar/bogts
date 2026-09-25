<!--
	Where the payer lands after Bonum's hosted checkout (ux-brief §14.2). The
	outcome is our own stored status, never a query param; the only redirect
	target is the invoice's stored return URL.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import PublicState from '$lib/components/public/PublicState.svelte';
	import { pollStatus, type PolledStatus } from '$lib/checkout';
	import { formatAmountIn, formatDateTimeIn, formatMoneyIn, translator } from '$lib/i18n/public';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const inv = $derived(data.invoice);
	const payee = $derived(data.payee);
	const t = $derived(translator(data.locale));
	const amount = $derived(formatMoneyIn(data.locale, inv.amount));

	let polled = $state<string | null>(null);
	let slow = $state(false);
	const status = $derived(polled ?? inv.status);

	function onStatus(s: PolledStatus) {
		polled = s;
		if (s === 'paid' && inv.returnUrl) {
			const target = inv.returnUrl;
			setTimeout(() => window.location.assign(target), 2600);
		}
	}

	onMount(() => {
		if (status === 'paid' && inv.returnUrl) {
			const target = inv.returnUrl;
			const timer = setTimeout(() => window.location.assign(target), 2600);
			return () => clearTimeout(timer);
		}
		if (status !== 'pending') return;
		const poller = pollStatus(inv.id, { until: Date.now() + 30_000, onStatus, onGiveUp: () => (slow = true) });
		return () => poller.stop();
	});
</script>

<svelte:head>
	<title>{status === 'paid' ? t('state.paid.title') : amount} · {payee.name}</title>
	<meta name="robots" content="noindex" />
	{#if status === 'paid' && inv.returnUrl}
		<meta http-equiv="refresh" content="3;url={inv.returnUrl}" />
	{:else if status === 'pending'}
		<noscript><meta http-equiv="refresh" content="5" /></noscript>
	{/if}
</svelte:head>

<PublicShell {payee} locale={data.locale} {t} sandbox={data.sandbox}>
	{#snippet summary()}
		<p class="amount display" aria-label={t('money.label', { amount: formatAmountIn(data.locale, inv.amount) })}>{amount}</p>
		{#if inv.description}<p class="desc">{inv.description}</p>{/if}
	{/snippet}

	{#snippet action()}
		{#if status === 'paid'}
			<PublicState kind="paid" title={t('state.paid.title')}>
				{#if inv.paidAt}<p class="small">{t('state.paid.at', { time: formatDateTimeIn(data.locale, inv.paidAt) })}</p>{/if}
				{#if inv.returnUrl}
					<p class="returning"><span class="spinner" aria-hidden="true"></span> {t('state.returning')}</p>
					<a class="btn primary lg block" href={inv.returnUrl} rel="external">{t('state.returnNow')}</a>
				{/if}
			</PublicState>
		{:else if status === 'pending' && !slow}
			<PublicState kind="confirming" title={t('state.confirming')} />
		{:else if status === 'pending'}
			<PublicState kind="slow" title={t('state.slow.title')}>
				<p>{t('state.slow.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn primary lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{:else if status === 'expired'}
			<PublicState kind="expired" title={t('state.expired.title')}>
				<p>{t('state.expired.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{:else if status === 'cancelled'}
			<PublicState kind="cancelled" title={t('state.cancelled.title')}>
				<p>{t('state.cancelled.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{:else}
			<PublicState kind="failed" title={t('state.failed.title')}>
				<p>{t('state.failed.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{/if}
	{/snippet}
</PublicShell>

<style>
	.amount {
		font-size: 44px;
		line-height: 52px;
		overflow-wrap: anywhere;
	}
	.desc {
		margin-top: var(--space-2);
		font-size: var(--text-lg);
		line-height: var(--lh-lg);
		color: var(--fg-muted);
		overflow-wrap: anywhere;
		max-width: 36ch;
	}
	.small {
		font-size: var(--text-sm);
	}
	.returning {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border-strong);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
