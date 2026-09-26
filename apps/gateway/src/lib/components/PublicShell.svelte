<!--
	The frame of the public pages (/pay, /return, errors): no admin chrome.
	Reading order: the brand (logo, name), the summary (amount as the hero,
	description), then the action (QR and banks, or a state), then help and
	the "secure payment" line.

	Phones: one column; the summary sits on an accent-tinted band edged with
	a хээ (key-fret) border. From 880px: Stripe-style split, summary on the
	left, action on the right.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { mailtoHref } from '$lib/brand';
	import type { Locale, Translate } from '$lib/i18n/public';
	import BogtsMark from './brand/BogtsMark.svelte';
	import BrandLogo from './brand/BrandLogo.svelte';
	import Icon from './Icon.svelte';
	import LangPicker from './public/LangPicker.svelte';

	type Payee = { name: string; logoUrl: string | null; supportEmail: string | null; supportUrl: string | null };

	let {
		payee,
		locale,
		t,
		sandbox = false,
		summary,
		action,
		note
	}: {
		payee: Payee | null;
		locale: Locale;
		t: Translate;
		sandbox?: boolean;
		summary?: Snippet;
		action?: Snippet;
		/** A small line under the footer (the invoice id) */
		note?: Snippet;
	} = $props();

	const mailto = $derived(mailtoHref(payee?.supportEmail));
	const hasSupport = $derived(!!(mailto || payee?.supportUrl));
</script>

<div class="public" class:split={!!action && !!summary}>
	{#if sandbox}<div class="strip" role="status"><Icon name="flask" size={14} /> {t('sandbox')}</div>{/if}
	<div class="frame">
		<header class="brand">
			{#if payee}
				<BrandLogo src={payee.logoUrl} name={payee.name} size={36} />
				<span class="payee">{payee.name}</span>
			{:else}
				<BogtsMark size={36} />
				<span class="payee">Bogts</span>
			{/if}
			<span class="grow"></span>
			<LangPicker {locale} label={t('lang.label')} />
		</header>

		{#if summary}
			<section class="summary">{@render summary()}</section>
		{/if}

		{#if action}
			<section class="action">{@render action()}</section>
		{/if}

		<footer class="foot">
			{#if hasSupport && payee}
				<p class="support">
					<span class="subtle">{t('support.label')}:</span>
					{#if mailto}<a href={mailto}><Icon name="mail" size={14} /> {payee.supportEmail}</a>{/if}
					{#if payee.supportUrl}<a href={payee.supportUrl} rel="external noreferrer noopener" target="_blank"
							><Icon name="help" size={14} /> {t('support.site')}</a
						>{/if}
				</p>
			{/if}
			<p class="secured">
				<Icon name="lock" size={12} />
				<span>{t('footer.secured')}</span>
				<span class="dot" aria-hidden="true"></span>
				<span class="by"><BogtsMark size={14} /> Bogts</span>
			</p>
			{#if note}<p class="note">{@render note()}</p>{/if}
		</footer>
	</div>
</div>

<style>
	.public {
		--fret-v: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='16' viewBox='0 0 10 16'%3E%3Cpath d='M.75 0v16M.75 12.25h8.5v-8.5h-5v5h2' fill='none' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E");
		--band: color-mix(in srgb, var(--accent-subtle) 85%, var(--bg-subtle));
		--fret: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='10' viewBox='0 0 16 10'%3E%3Cpath d='M0 9.25h16M12.25 9.25V.75h-8.5v5h5v-2' fill='none' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E");
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--fg);
	}
	.strip {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px var(--space-4);
		background: var(--sandbox-bg);
		color: var(--sandbox-fg);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		text-align: center;
	}

	/* One column (phones, and pages without an action) */
	.frame {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: 'brand' 'summary' 'action' 'foot';
		grid-template-rows: auto auto auto 1fr;
		width: 100%;
	}
	.brand,
	.summary,
	.action,
	.foot {
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		padding-left: var(--space-4);
		padding-right: var(--space-4);
	}
	.brand {
		grid-area: brand;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-top: var(--space-4);
		padding-bottom: var(--space-4);
		min-width: 0;
	}
	.payee {
		font-weight: var(--weight-semibold);
		font-size: var(--text-lg);
		line-height: 1.25;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.grow {
		flex: 1;
	}
	.summary {
		grid-area: summary;
		padding-top: var(--space-2);
		padding-bottom: var(--space-8);
	}
	.action {
		grid-area: action;
		padding-top: var(--space-6);
		padding-bottom: var(--space-6);
	}
	.foot {
		grid-area: foot;
		align-self: end;
		display: grid;
		gap: var(--space-2);
		padding-top: var(--space-6);
		padding-bottom: var(--space-6);
		font-size: var(--text-sm);
		color: var(--fg-subtle);
		text-align: center;
	}
	.support {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px var(--space-3);
	}
	.support a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		overflow-wrap: anywhere;
	}
	.secured {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: var(--text-xs);
	}
	.by {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-weight: var(--weight-medium);
		color: var(--fg-muted);
	}
	.dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: currentColor;
	}
	.note {
		font-size: var(--text-xs);
	}

	/* Phones: the brand and summary sit on a tinted band with a key-fret edge. */
	.split .brand,
	.split .summary {
		background: var(--band);
		max-width: none;
		padding-left: max(var(--space-4), calc(50% - 240px + var(--space-4)));
		padding-right: max(var(--space-4), calc(50% - 240px + var(--space-4)));
	}
	.split .summary {
		position: relative;
	}
	.split .summary::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 10px;
		background: var(--accent);
		opacity: 0.32;
		mask: var(--fret) repeat-x left bottom / 16px 10px;
		-webkit-mask: var(--fret) repeat-x left bottom / 16px 10px;
	}

	@media (min-width: 880px) {
		.split .frame {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas: 'brand action' 'summary action' 'foot action';
			grid-template-rows: auto auto 1fr;
			background: linear-gradient(90deg, var(--band) 50%, var(--bg) 50%);
		}
		.split .brand,
		.split .summary,
		.split .foot {
			max-width: none;
			background: none;
			padding-left: max(var(--space-8), calc(100% - 440px - var(--space-12)));
			padding-right: var(--space-12);
		}
		.split .brand {
			padding-top: var(--space-12);
		}
		.split .summary {
			padding-top: var(--space-10);
		}
		.split .summary::after {
			display: none;
		}
		.split .foot {
			align-self: start;
			text-align: left;
			padding-top: 0;
			padding-bottom: var(--space-10);
		}
		.split .support,
		.split .secured {
			justify-content: flex-start;
		}
		.split .action {
			position: relative;
			max-width: none;
			margin: 0;
			padding: var(--space-12) max(var(--space-8), calc(100% - 440px - var(--space-12))) var(--space-10) var(--space-12);
		}
		/*
		 * A state (paid, failed…) lines up with the left half: flush left, its
		 * picture's top on the brand row, the heading on the amount's line.
		 * The paid moment's coin headroom hangs above the column.
		 */
		.split .action :global(.state) {
			justify-items: start;
			text-align: start;
			padding-top: 0;
		}
		.split .action :global(.state .more) {
			justify-items: start;
		}
		.split .action :global(.moment) {
			margin-top: -24px;
		}
		/* Smaller pictures sit at the foot of the pouch's 96px, keeping the heading on that line. */
		.split .action :global(.state > .icon),
		.split .action :global(.state > .coin-spin) {
			margin-top: 32px;
		}
		/* The key-fret runs down the seam between the halves. */
		.split .action::before {
			content: '';
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			width: 10px;
			background: var(--accent);
			opacity: 0.3;
			mask: var(--fret-v) repeat-y left top / 10px 16px;
			-webkit-mask: var(--fret-v) repeat-y left top / 10px 16px;
		}
	}
</style>
