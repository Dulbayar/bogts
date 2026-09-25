<!--
	The hosted QPay checkout (ux-brief §14.1). Works without JavaScript (the
	page refreshes itself); with it, the status is polled and a paid invoice
	returns the payer to the project.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Money from '$lib/components/Money.svelte';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import { FINAL, fetchStatus, pollStatus, type PolledStatus } from '$lib/checkout';
	import { formatCountdown, formatMoney, truncateMiddle } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const inv = $derived(data.invoice);

	/** Set by polling; until then the server's answer stands. */
	let polled = $state<string | null>(null);
	const status = $derived(polled ?? inv.status);
	let now = $state(Date.now());
	let js = $state(false);
	let wide = $state(false);
	let checking = $state(false);
	let checkNote = $state('');
	let lastCheck = 0;
	let poller: ReturnType<typeof pollStatus> | null = null;

	const left = $derived(inv.expiresAt - now);
	const shown = $derived(status === 'pending' && left <= 0 ? 'expired' : status);

	let redirecting = false;

	function onStatus(s: PolledStatus) {
		polled = s;
		if (s === 'paid' && inv.returnUrl && !redirecting) {
			redirecting = true;
			const target = inv.returnUrl;
			setTimeout(() => window.location.assign(target), 2000);
		}
	}

	onMount(() => {
		js = true;
		const mq = window.matchMedia('(min-width: 640px)');
		wide = mq.matches;
		const onChange = () => (wide = mq.matches);
		mq.addEventListener('change', onChange);
		const tick = setInterval(() => (now = Date.now()), 1000);
		if (status === 'pending') poller = pollStatus(inv.id, { until: inv.expiresAt + 60_000, onStatus });
		return () => {
			mq.removeEventListener('change', onChange);
			clearInterval(tick);
			poller?.stop();
		};
	});

	async function checkNow(e: SubmitEvent) {
		e.preventDefault();
		if (Date.now() - lastCheck < 5000 || checking) return;
		lastCheck = Date.now();
		checking = true;
		checkNote = '';
		const s = await fetchStatus(inv.id);
		checking = false;
		if (s) {
			onStatus(s);
			if (FINAL.has(s)) poller?.stop();
		}
		if (s !== 'paid') checkNote = 'Not received yet';
		setTimeout(() => (checkNote = ''), 4000);
	}
</script>

<svelte:head>
	<title>{formatMoney(inv.amount)} · {inv.projectName}</title>
	<meta name="robots" content="noindex" />
	{#if shown === 'pending'}
		<noscript><meta http-equiv="refresh" content="15" /></noscript>
	{:else if shown === 'paid' && inv.returnUrl}
		<meta http-equiv="refresh" content="2;url={inv.returnUrl}" />
	{/if}
</svelte:head>

{#snippet qrBlock()}
	<div class="qr-tile">
		{#if inv.qr?.image}
			<img src="data:image/png;base64,{inv.qr.image}" alt="QR code for this payment" width="240" height="240" />
		{:else if inv.qr?.path}
			<svg viewBox="-2 -2 {inv.qr.size + 4} {inv.qr.size + 4}" width="240" height="240" role="img" aria-label="QR code for this payment" shape-rendering="crispEdges">
				<rect x="-2" y="-2" width={inv.qr.size + 4} height={inv.qr.size + 4} fill="#fff" />
				<path d={inv.qr.path} fill="#000" />
			</svg>
		{/if}
	</div>
	<p class="hint">Scan with any bank app</p>
{/snippet}

<PublicShell sandbox={data.sandbox}>
	<header class="summary">
		<p class="project">{inv.projectName}</p>
		<p class="amount"><Money amount={inv.amount} /></p>
		{#if inv.description}<p class="desc">{inv.description}</p>{/if}
	</header>

	{#if shown === 'paid'}
		<section class="state" role="status">
			<span class="icon ok"><Icon name="check" size={28} /></span>
			<h1>Payment complete</h1>
			{#if inv.returnUrl}
				<p class="muted"><span class="spinner" aria-hidden="true"></span> Returning you to {inv.projectName}…</p>
				<a class="btn lg block" href={inv.returnUrl}>Return now</a>
			{/if}
		</section>
	{:else if shown === 'expired'}
		<section class="state">
			<span class="icon"><Icon name="clock" size={28} /></span>
			<h1>This payment link has expired</h1>
			<p class="muted">Go back to {inv.projectName} to start again.</p>
			{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl}>Back to {inv.projectName}</a>{/if}
		</section>
	{:else if shown !== 'pending'}
		<section class="state">
			<span class="icon bad"><Icon name="x" size={28} /></span>
			<h1>Payment didn't go through</h1>
			{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl}>Back to {inv.projectName}</a>{/if}
		</section>
	{:else}
		<div class="pay">
			{#if inv.qr}
				<section class="qr">
					{#if js && wide}
						{@render qrBlock()}
					{:else}
						<details class="qr-toggle">
							<summary><Icon name="qr" /> Show QR to scan from another phone</summary>
							{@render qrBlock()}
						</details>
					{/if}
				</section>
			{/if}

			{#if inv.deeplinks.length}
				<section class="banks" aria-labelledby="banks-title">
					<h2 id="banks-title" class="divider"><span>{inv.qr && js && wide ? 'or open your bank app' : 'Open your bank app'}</span></h2>
					<ul>
						{#each inv.deeplinks as d (d.link)}
							<li>
								<a href={d.link} rel="noreferrer">
									<span class="mono-avatar" aria-hidden="true">{d.name.slice(0, 1).toUpperCase()}</span>
									<span class="bank">{d.name}</span>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>

		<section class="waiting">
			<p class="status" role="status">
				<Icon name="clock" size={14} /> Waiting for payment…
				<span class="subtle num">expires in {formatCountdown(left)}</span>
			</p>
			<form method="GET" onsubmit={checkNow}>
				<button type="submit" class="btn lg block" disabled={checking}>{checking ? 'Checking…' : "I've paid: check now"}</button>
			</form>
			<p class="note" aria-live="polite">{checkNote}</p>
		</section>
	{/if}

	{#snippet footer()}
		Secured by Bogts · Invoice <span class="mono">{truncateMiddle(inv.id)}</span>
	{/snippet}
</PublicShell>

<style>
	.summary {
		text-align: center;
		display: grid;
		gap: var(--space-1);
	}
	.project {
		font-weight: var(--weight-medium);
		color: var(--fg-muted);
	}
	.amount {
		font-size: 32px;
		line-height: 40px;
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}
	.desc {
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.pay {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.qr {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
	}
	.qr-tile {
		display: grid;
		place-items: center;
		width: 272px;
		max-width: 100%;
		aspect-ratio: 1;
		margin: 0 auto;
		padding: var(--space-4);
		background: #fff;
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
	}
	.qr-tile img,
	.qr-tile svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.hint {
		text-align: center;
		font-size: var(--text-sm);
		color: var(--fg-muted);
		margin-top: var(--space-2);
	}
	.qr-toggle {
		width: 100%;
	}
	.qr-toggle summary {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-2);
		min-height: 44px;
		color: var(--accent);
		font-size: var(--text-sm);
		cursor: pointer;
		list-style: none;
	}
	.qr-toggle summary::-webkit-details-marker {
		display: none;
	}
	.qr-toggle[open] summary {
		margin-bottom: var(--space-3);
	}
	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-regular);
		color: var(--fg-subtle);
		margin-bottom: var(--space-3);
	}
	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--border);
	}
	.banks ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.banks a {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 6px;
		min-height: 76px;
		padding: var(--space-2) 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		color: var(--fg);
		text-decoration: none;
		text-align: center;
	}
	.banks a:hover {
		background: var(--bg-subtle);
	}
	.mono-avatar {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-md);
		background: var(--bg-muted);
		font-weight: var(--weight-semibold);
		color: var(--fg-muted);
	}
	.bank {
		font-size: var(--text-xs);
		line-height: 14px;
		overflow-wrap: anywhere;
	}
	.waiting {
		display: grid;
		gap: var(--space-3);
	}
	.status {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		font-size: var(--text-sm);
		color: var(--fg-muted);
	}
	.note {
		min-height: 20px;
		text-align: center;
		font-size: var(--text-sm);
		color: var(--fg-muted);
	}
	.btn.lg {
		height: 44px;
	}
	.state {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		text-align: center;
	}
	.state h1 {
		font-size: var(--text-xl);
		line-height: var(--lh-xl);
		font-weight: var(--weight-semibold);
	}
	.state .icon {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--bg-muted);
		color: var(--fg-muted);
	}
	.state .icon.ok {
		background: var(--success-bg);
		color: var(--success-fg);
	}
	.state .icon.bad {
		background: var(--danger-bg);
		color: var(--danger-fg);
	}
	.state p {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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
	/* On a phone you can't scan your own screen: bank apps come first. */
	@media (max-width: 639px) {
		.banks {
			order: -1;
		}
		.banks .divider span {
			white-space: nowrap;
		}
	}
</style>
