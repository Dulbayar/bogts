<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import EnvBanner from '$lib/components/EnvBanner.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { palette } from '$lib/brand';
	import { faviconSvg } from '$lib/components/brand/favicon';
	import { startClock } from '$lib/ui.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const sandbox = $derived(data.env.mode === 'sandbox' || data.env.mode === 'mixed');
	// The company logo, else the Bogts pouch in the accent; an amber dot in sandbox (ux-brief §11).
	const brand = $derived((page.data as { brand?: typeof data.brand }).brand ?? data.brand);
	const favicon = $derived(brand.logoUrl && !sandbox ? brand.logoUrl : faviconSvg(palette(brand.accent).light.accent, sandbox));

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
