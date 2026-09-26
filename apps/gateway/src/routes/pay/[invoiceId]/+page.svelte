<!--
	The hosted QPay checkout (ux-brief §14.1). Works without JavaScript (the
	page refreshes itself); with it, the status is polled and a paid invoice
	returns the payer to the project. Phones get the bank apps first (you
	can't scan your own screen); wide screens get the QR first.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import PublicState from '$lib/components/public/PublicState.svelte';
	import { BANKS_SHOWN, bankTiles } from '$lib/banks';
	import { FINAL, fetchStatus, pollStatus, type PolledStatus } from '$lib/checkout';
	import { formatCountdown, truncateMiddle } from '$lib/format';
	import { formatAmountIn, formatDateTimeIn, formatMoneyIn, translator } from '$lib/i18n/public';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const inv = $derived(data.invoice);
	const payee = $derived(data.payee);
	const t = $derived(translator(data.locale));
	const amount = $derived(formatMoneyIn(data.locale, inv.amount));

	/** Set by polling; until then the server's answer stands. */
	let polled = $state<string | null>(null);
	let paidAt = $state<number | null>(null);
	const status = $derived(polled ?? inv.status);
	let now = $state(Date.now());
	let checking = $state(false);
	let checkNote = $state('');
	let lastCheck = 0;
	let poller: ReturnType<typeof pollStatus> | null = null;

	const left = $derived(inv.expiresAt - now);
	const shown = $derived(status === 'pending' && left <= 0 ? 'expired' : status);
	const paidTime = $derived(paidAt ?? inv.paidAt);

	let redirecting = false;

	function onStatus(s: PolledStatus) {
		polled = s;
		if (s === 'paid') {
			paidAt ??= Date.now();
			if (inv.returnUrl && !redirecting) {
				redirecting = true;
				const target = inv.returnUrl;
				setTimeout(() => window.location.assign(target), 2600);
			}
		}
	}

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		if (status === 'pending') poller = pollStatus(inv.id, { until: inv.expiresAt + 60_000, onStatus });
		return () => {
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
		if (s !== 'paid') checkNote = t('pay.notYet');
		setTimeout(() => (checkNote = ''), 4000);
	}

	/** Popular apps first; past a full 3×3 the rest wait behind "More". */
	const tiles = $derived(bankTiles(inv.deeplinks));
	/** Nine fit as they are: a More tile hiding one bank would be pointless. */
	const collapsible = $derived(tiles.length > BANKS_SHOWN + 1);
	let expanded = $state(false);
	const collapsed = $derived(collapsible && !expanded);
	const hiddenCount = $derived(tiles.length - BANKS_SHOWN);
	/** The More tile's folder look: four logos of the banks it hides, or nothing. */
	const peek = $derived.by(() => {
		const withLogo = tiles.slice(BANKS_SHOWN).filter((d) => d.logo);
		return withLogo.length >= 4 ? withLogo.slice(0, 4) : [];
	});
	async function showAll() {
		expanded = true;
		await tick();
		document.querySelector<HTMLAnchorElement>('#bank-list li.extra a')?.focus();
	}

	const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

	/**
	 * A bank logo that fails to load (QPay down, a blocked host) is hidden, so
	 * the initial tile under it shows. Attached, not an `onerror` attribute:
	 * the CSP blocks inline handlers, and this also catches a failure that
	 * happened before hydration.
	 */
	function letterOnError(img: HTMLImageElement) {
		const hide = () => (img.hidden = true);
		if (img.complete && img.naturalWidth === 0) hide();
		img.addEventListener('error', hide);
		return () => img.removeEventListener('error', hide);
	}
</script>

<svelte:head>
	<title>{shown === 'paid' ? t('state.paid.title') : t('pay.title')} · {amount} · {payee.name}</title>
	<meta name="robots" content="noindex" />
	{#if shown === 'pending'}
		<noscript><meta http-equiv="refresh" content="15" /></noscript>
		<!-- No JS, no More button: every bank shows. -->
		<noscript><style>.banks .extra { display: grid !important; } .banks .more-item { display: none !important; }</style></noscript>
	{:else if shown === 'paid' && inv.returnUrl}
		<meta http-equiv="refresh" content="3;url={inv.returnUrl}" />
	{/if}
</svelte:head>

{#snippet qr()}
	<div class="qr-tile">
		{#if inv.qr?.image}
			<img src="data:image/png;base64,{inv.qr.image}" alt={t('pay.qrAlt')} width="232" height="232" />
		{:else if inv.qr?.path}
			<svg viewBox="-2 -2 {inv.qr.size + 4} {inv.qr.size + 4}" width="232" height="232" role="img" aria-label={t('pay.qrAlt')} shape-rendering="crispEdges">
				<rect x="-2" y="-2" width={inv.qr.size + 4} height={inv.qr.size + 4} fill="#fff" />
				<path d={inv.qr.path} fill="#000" />
			</svg>
		{/if}
	</div>
{/snippet}

<PublicShell {payee} locale={data.locale} {t} sandbox={data.sandbox}>
	{#snippet summary()}
		<p class="amount display" aria-label={t('money.label', { amount: formatAmountIn(data.locale, inv.amount) })}>{amount}</p>
		{#if inv.description}<p class="desc">{inv.description}</p>{/if}
	{/snippet}

	{#snippet action()}
		{#if shown === 'paid'}
			<PublicState kind="paid" title={t('state.paid.title')}>
				{#if paidTime}<p class="subtle small">{t('state.paid.at', { time: formatDateTimeIn(data.locale, paidTime) })}</p>{/if}
				{#if inv.returnUrl}
					<p class="returning"><span class="spinner" aria-hidden="true"></span> {t('state.returning')}</p>
					<a class="btn primary lg block" href={inv.returnUrl} rel="external">{t('state.returnNow')}</a>
				{/if}
			</PublicState>
		{:else if shown === 'expired'}
			<PublicState kind="expired" title={t('state.expired.title')}>
				<p>{t('state.expired.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{:else if shown === 'cancelled'}
			<PublicState kind="cancelled" title={t('state.cancelled.title')}>
				<p>{t('state.cancelled.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{:else if shown !== 'pending'}
			<PublicState kind="failed" title={t('state.failed.title')}>
				<p>{t('state.failed.body', { name: payee.name })}</p>
				{#if inv.returnUrl}<a class="btn lg block" href={inv.returnUrl} rel="external">{t('state.back', { name: payee.name })}</a>{/if}
			</PublicState>
		{:else}
			<div class="pay">
				{#if inv.qr}
					<section class="qr wide-only" aria-labelledby="scan-title">
						{@render qr()}
						<h2 id="scan-title" class="scan">{t('pay.scan')}</h2>
					</section>
				{/if}

				{#if inv.deeplinks.length}
					<section class="banks" aria-labelledby="banks-title">
						<h2 id="banks-title" class="banks-title">
							<span class="wide-only">{inv.qr ? t('pay.orBanks') : t('pay.banks')}</span>
							<span class="narrow-only">{t('pay.banks')}</span>
						</h2>
						<ul id="bank-list" class:collapsed class:expanded>
							{#each tiles as d, i (d.link)}
								{@const extra = collapsible && i >= BANKS_SHOWN}
								<li class:extra style:--i={extra ? i - BANKS_SHOWN : null}>
									<a href={d.link} rel="external noreferrer">
										<span class="bank-logo" aria-hidden="true">
											<span class="initial">{initial(d.label)}</span>
											{#if d.logo}
												<img src={d.logo} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" {@attach letterOnError} />
											{/if}
										</span>
										<span class="bank-name">{d.label}</span>
									</a>
								</li>
							{/each}
							{#if collapsed}
								<li class="more-item">
									<button type="button" class="more" aria-expanded={expanded} aria-controls="bank-list" onclick={showAll}>
										{#if peek.length}
											<span class="bank-logo peek" aria-hidden="true">
												{#each peek as p (p.link)}
													<img src={p.logo} alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer" {@attach letterOnError} />
												{/each}
											</span>
										{:else}
											<span class="bank-logo" aria-hidden="true"><Icon name="more" /></span>
										{/if}
										<span class="bank-name">{t('pay.more')}<span class="sr-only"> ({t('pay.moreCount', { count: hiddenCount })})</span></span>
									</button>
								</li>
							{/if}
						</ul>
					</section>
				{/if}

				{#if inv.qr}
					<details class="qr-toggle narrow-only">
						<summary><Icon name="qr" /> <span>{t('pay.showQr')}</span> <span class="chev" aria-hidden="true"><Icon name="chevronDown" size={14} /></span></summary>
						<div class="qr">{@render qr()}</div>
					</details>
				{/if}
			</div>

			<section class="waiting">
				<p class="status" role="status">
					<span class="pulse" aria-hidden="true"></span>
					<span>{t('pay.waiting')}</span>
					<span class="timer num">{t('pay.expiresIn', { time: formatCountdown(left) })}</span>
				</p>
				<form method="GET" onsubmit={checkNow}>
					<button type="submit" class="btn lg block" disabled={checking}>{checking ? t('pay.checking') : t('pay.checkNow')}</button>
				</form>
				<p class="note" aria-live="polite">{checkNote}</p>
			</section>
		{/if}
	{/snippet}

	{#snippet note()}
		{t('footer.invoice', { id: '' })}<span class="mono">{truncateMiddle(inv.id)}</span>
	{/snippet}
</PublicShell>

<style>
	.amount {
		font-size: 44px;
		line-height: 52px;
		overflow-wrap: anywhere;
		animation: rise 420ms var(--ease) both;
	}
	.desc {
		margin-top: var(--space-2);
		font-size: var(--text-lg);
		line-height: var(--lh-lg);
		color: var(--fg-muted);
		overflow-wrap: anywhere;
		max-width: 36ch;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.pay {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.qr {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
	}
	.qr-tile {
		display: grid;
		place-items: center;
		width: 264px;
		max-width: 100%;
		aspect-ratio: 1;
		padding: var(--space-4);
		background: #fff;
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-md);
	}
	.qr-tile img,
	.qr-tile svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.scan {
		font-size: var(--text-sm);
		font-weight: var(--weight-regular);
		color: var(--fg-muted);
		text-align: center;
	}

	.banks-title {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--fg-muted);
	}
	.banks-title::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--border);
	}
	.banks ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.banks li {
		display: grid;
	}
	.banks a,
	.banks .more {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 92px;
		padding: var(--space-3) var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg);
		color: var(--fg);
		font: inherit;
		text-decoration: none;
		text-align: center;
		transition:
			border-color var(--dur-fast) var(--ease),
			box-shadow var(--dur-fast) var(--ease),
			transform var(--dur-fast) var(--ease);
	}
	.banks .more {
		cursor: pointer;
		appearance: none;
	}
	.banks a:hover,
	.banks .more:hover {
		border-color: var(--accent-border);
		box-shadow: var(--shadow-md);
		transform: translateY(-1px);
	}
	.banks a:active,
	.banks .more:active {
		transform: translateY(0) scale(0.98);
	}
	.banks a:focus-visible,
	.banks .more:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
		border-color: var(--accent-border);
	}
	/* Past the first eight, hidden until More; a short staggered rise on reveal. */
	.banks ul.collapsed .extra {
		display: none;
	}
	.banks ul.expanded .extra {
		animation: rise 320ms var(--ease) both;
		animation-delay: min(calc(var(--i, 0) * 30ms), 300ms);
	}
	.bank-logo {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: var(--accent-subtle);
		color: var(--accent-text);
		overflow: hidden;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 8%, transparent);
	}
	.bank-logo img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		background: #fff;
	}
	/* An iOS-folder peek at the banks behind More. */
	.bank-logo.peek {
		grid-template-columns: repeat(2, 1fr);
		grid-template-rows: repeat(2, 1fr);
		place-items: stretch;
		gap: 3px;
		padding: 5px;
		background: var(--bg-muted);
	}
	.bank-logo.peek img {
		position: static;
		width: 100%;
		height: 100%;
		border-radius: 4px;
		box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--fg) 10%, transparent);
	}
	.initial {
		font-family: var(--font-display);
		font-weight: var(--weight-semibold);
		font-size: 20px;
	}
	.bank-name {
		font-size: var(--text-xs);
		line-height: 15px;
		color: var(--fg-muted);
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.qr-toggle {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.qr-toggle summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 48px;
		padding: 0 var(--space-4);
		color: var(--fg);
		font-size: var(--text-sm);
		cursor: pointer;
		list-style: none;
	}
	.qr-toggle summary::-webkit-details-marker {
		display: none;
	}
	.qr-toggle summary span:not(.chev) {
		flex: 1;
	}
	.qr-toggle .chev {
		display: inline-grid;
		color: var(--fg-subtle);
		transition: transform var(--dur-base) var(--ease);
	}
	.qr-toggle[open] .chev {
		transform: rotate(180deg);
	}
	.qr-toggle .qr {
		padding: 0 var(--space-4) var(--space-4);
	}

	.waiting {
		display: grid;
		gap: var(--space-3);
		margin-top: var(--space-6);
		padding-top: var(--space-5);
		border-top: 1px dashed var(--border-strong);
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
	.pulse {
		position: relative;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
	}
	.pulse::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--accent);
		animation: ping 1.8s var(--ease) infinite;
	}
	@keyframes ping {
		from {
			transform: scale(1);
			opacity: 0.55;
		}
		to {
			transform: scale(3);
			opacity: 0;
		}
	}
	.timer {
		padding: 2px var(--space-2);
		border-radius: var(--radius-full);
		background: var(--bg-muted);
		color: var(--fg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}
	.note {
		min-height: 20px;
		text-align: center;
		font-size: var(--text-sm);
		color: var(--fg-muted);
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

	/* Phones: the waiting line and the check button stay in reach under a long bank list. */
	@media (max-width: 879px) {
		.waiting {
			position: sticky;
			bottom: 0;
			z-index: 5;
			gap: var(--space-2);
			margin: var(--space-6) calc(var(--space-4) * -1) calc(var(--space-6) * -1);
			padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom));
			background: color-mix(in srgb, var(--bg) 90%, transparent);
			backdrop-filter: blur(10px);
			border-top: 1px solid var(--border);
			box-shadow: 0 -8px 20px -12px rgb(0 0 0 / 0.18);
		}
	}
	/* Stays in the tree (it is the live region), but takes no room until it speaks. */
	.note:empty {
		min-height: 0;
		margin-top: calc(var(--space-2) * -1);
	}

	/* Phones: bank apps first; the QR behind a disclosure. */
	.wide-only {
		display: none;
	}
	@media (min-width: 880px) {
		.amount {
			font-size: 56px;
			line-height: 64px;
		}
		/* Wide screens: a floating bar at the bottom of the right half. */
		.waiting {
			position: sticky;
			bottom: var(--space-4);
			z-index: 5;
			padding: var(--space-3) var(--space-4) var(--space-2);
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			background: color-mix(in srgb, var(--bg) 92%, transparent);
			backdrop-filter: blur(10px);
			box-shadow: var(--shadow-lg);
		}
		.wide-only {
			display: revert;
		}
		section.wide-only {
			display: grid;
		}
		.narrow-only {
			display: none;
		}
		.banks-title::before {
			content: '';
			flex: 1;
			border-top: 1px solid var(--border);
		}
		.banks-title {
			justify-content: center;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse::after,
		.banks ul.expanded .extra {
			animation: none;
		}
	}
</style>
