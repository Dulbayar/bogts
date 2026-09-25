<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import EnvBanner from '$lib/components/EnvBanner.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { startClock } from '$lib/ui.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const sandbox = $derived(data.env.mode === 'sandbox' || data.env.mode === 'mixed');
	// A tiny favicon; amber dot in sandbox (ux-brief §11). data: URIs are allowed by the CSP's img-src.
	const favicon = $derived(
		`data:image/svg+xml,${encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#3451d1"/><path d="M10 13c0-3 2.7-5 6-5s6 2 6 5v7c0 2.8-2.7 4-6 4s-6-1.2-6-4z" fill="#fff"/>${
				sandbox ? '<circle cx="25" cy="7" r="6" fill="#f5a524" stroke="#fff" stroke-width="2"/>' : ''
			}</svg>`
		)}`
	);

	onMount(startClock);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="theme-root" class:sandbox data-theme={data.theme === 'system' ? undefined : data.theme}>
	<EnvBanner {...data.env} />
	{@render children()}
	<Toaster />
</div>

<style>
	.theme-root {
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg-subtle);
		color: var(--fg);
	}
	/* Still visible when the banner has scrolled away (mobile). */
	.sandbox::after {
		content: '';
		position: fixed;
		inset: 0;
		border: 2px solid var(--sandbox-bg);
		pointer-events: none;
		z-index: 60;
	}
</style>
