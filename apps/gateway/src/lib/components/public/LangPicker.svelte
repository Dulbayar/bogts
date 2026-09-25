<!--
	The public pages' language picker: plain links (`?lang=`), so it works
	without JavaScript; the server remembers the choice in a cookie. A full
	reload (`rel="external"`), because `<html lang>` and every string change.
-->
<script lang="ts">
	import { LOCALES, NATIVE_NAMES, type Locale } from '$lib/i18n/public';
	import Icon from '../Icon.svelte';

	let { locale, label }: { locale: Locale; label: string } = $props();
</script>

<details class="lang">
	<summary aria-label="{label}: {NATIVE_NAMES[locale]}">
		<Icon name="globe" size={14} />
		<span>{NATIVE_NAMES[locale]}</span>
		<span class="chev" aria-hidden="true"><Icon name="chevronDown" size={12} /></span>
	</summary>
	<ul>
		{#each LOCALES as l (l)}
			<li>
				<a
					href="?lang={l}"
					hreflang={l}
					lang={l}
					rel="external"
					aria-current={l === locale ? 'true' : undefined}
				>
					{NATIVE_NAMES[l]}
					{#if l === locale}<Icon name="check" size={14} />{/if}
				</a>
			</li>
		{/each}
	</ul>
</details>

<style>
	.lang {
		position: relative;
		font-size: var(--text-sm);
	}
	summary {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		color: var(--fg-muted);
		cursor: pointer;
		list-style: none;
		white-space: nowrap;
		transition:
			color var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:hover {
		color: var(--fg);
		border-color: var(--border-strong);
	}
	.chev {
		display: inline-grid;
		transition: transform var(--dur-base) var(--ease);
	}
	.lang[open] .chev {
		transform: rotate(180deg);
	}
	ul {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		z-index: 20;
		min-width: 168px;
		margin: 0;
		padding: 4px;
		list-style: none;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		animation: drop var(--dur-base) var(--ease);
	}
	a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 40px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--fg);
	}
	a:hover {
		background: var(--bg-muted);
		text-decoration: none;
	}
	a[aria-current] {
		color: var(--accent-text);
		font-weight: var(--weight-medium);
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
</style>
