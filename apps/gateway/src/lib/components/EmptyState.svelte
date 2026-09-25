<!--
	An empty list or page: an empty pouch (no coin yet) with the section's
	icon, a one-line title and an optional hint or action.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	let { icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: Snippet } = $props();
	const good = $derived(icon === 'check');
</script>

<div class="empty">
	<div class="art" aria-hidden="true">
		<svg class="pouch" viewBox="0 0 32 32" width="56" height="56">
			<path
				d="M11.6 12.6 9.7 7.3c-.3-.9.6-1.6 1.4-1.2l2.3 1.1L16 5l2.6 2.2 2.3-1.1c.8-.4 1.7.3 1.4 1.2l-1.9 5.3"
				fill="none"
				stroke="currentColor"
				stroke-width="1.1"
				stroke-linejoin="round"
			/>
			<path
				d="M11 12.4c-4.5 2.9-6 7.4-5.4 11 .7 4.2 4.8 5.9 10.4 5.9s9.7-1.7 10.4-5.9c.6-3.6-.9-8.1-5.4-11z"
				fill="var(--bg)"
				stroke="currentColor"
				stroke-width="1.1"
				stroke-linejoin="round"
			/>
			<rect x="9.6" y="10.9" width="12.8" height="3.1" rx="1.55" fill="var(--bg)" stroke="currentColor" stroke-width="1.1" />
		</svg>
		<span class="badge" class:good><Icon name={icon} size={14} /></span>
	</div>
	<p class="title">{title}</p>
	{#if children}<div class="more">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: var(--space-2);
		padding: var(--space-10) var(--space-4);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
		background:
			radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--accent-subtle) 70%, transparent) 0 64px, transparent 65px),
			var(--bg);
		color: var(--fg-subtle);
		text-align: center;
	}
	.art {
		position: relative;
		width: 56px;
		height: 56px;
		margin-bottom: var(--space-1);
		color: var(--border-strong);
	}
	.pouch {
		display: block;
	}
	.badge {
		position: absolute;
		right: -6px;
		bottom: 0;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--bg);
		border: 1px solid var(--accent-border);
		color: var(--accent-text);
		box-shadow: var(--shadow-sm);
	}
	.badge.good {
		border-color: var(--success-border);
		color: var(--success-fg);
	}
	.title {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		color: var(--fg);
	}
	.more {
		font-size: var(--text-sm);
		color: var(--fg-muted);
		max-width: 44ch;
	}
</style>
