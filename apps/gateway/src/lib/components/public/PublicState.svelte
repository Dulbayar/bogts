<!--
	A final or waiting state on a public page: its picture, a heading, one
	line, and the way back. `paid` plays the coin-into-pouch moment;
	`confirming` spins a coin.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../Icon.svelte';
	import PaidMoment from './PaidMoment.svelte';

	type Kind = 'paid' | 'confirming' | 'slow' | 'expired' | 'failed' | 'cancelled' | 'error' | 'missing';

	let { kind, title, children }: { kind: Kind; title: string; children?: Snippet } = $props();
</script>

<section class="state {kind}" role="status" aria-live="polite">
	{#if kind === 'paid'}
		<PaidMoment />
	{:else if kind === 'confirming'}
		<span class="coin-spin" aria-hidden="true"><span class="face"><span class="hole"></span></span></span>
	{:else}
		<span class="icon" aria-hidden="true">
			<Icon name={kind === 'expired' || kind === 'slow' ? 'hourglass' : kind === 'cancelled' ? 'slash' : kind === 'error' ? 'alert' : kind === 'missing' ? 'search' : 'x'} size={26} />
		</span>
	{/if}
	<h1>{title}</h1>
	{#if children}<div class="more">{@render children()}</div>{/if}
</section>

<style>
	.state {
		display: grid;
		justify-items: center;
		gap: var(--space-3);
		text-align: center;
		padding: var(--space-4) 0;
		animation: fade-in var(--dur-base) var(--ease);
	}
	h1 {
		font-family: var(--font-display);
		font-size: 26px;
		line-height: 32px;
		font-weight: var(--weight-semibold);
		letter-spacing: -0.01em;
		text-wrap: balance;
	}
	.more {
		display: grid;
		gap: var(--space-3);
		justify-items: center;
		width: 100%;
		color: var(--fg-muted);
	}
	.more :global(.btn) {
		margin-top: var(--space-2);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--bg-muted);
		color: var(--fg-muted);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.failed .icon,
	.error .icon {
		background: var(--danger-bg);
		color: var(--danger-fg);
		box-shadow: inset 0 0 0 1px var(--danger-border);
	}
	.slow .icon {
		background: var(--warning-bg);
		color: var(--warning-fg);
		box-shadow: inset 0 0 0 1px var(--warning-border);
	}
	/* A coin turning while we wait for the provider. */
	.coin-spin {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		perspective: 200px;
	}
	.face {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--brass) 55%, #fff), var(--brass) 55%, var(--brass-deep));
		box-shadow: 0 3px 8px rgb(0 0 0 / 0.15);
		animation: turn 1.6s linear infinite;
	}
	.hole {
		width: 11px;
		height: 11px;
		border-radius: 2px;
		background: var(--bg);
		box-shadow: inset 0 0 0 1px var(--brass-deep);
	}
	@keyframes turn {
		to {
			transform: rotateY(360deg);
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.face {
			animation: none;
		}
	}
</style>
