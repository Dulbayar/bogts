<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { brandVars } from '$lib/brand';
	import { faviconSvg } from '$lib/components/brand/favicon';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// The dashboard layout and the login page put the branding in their own data,
	// so read the merged page data. Validated hex values only (lib/brand.ts), so
	// inlining them is safe; app.css maps them onto the light and dark tokens.
	const accent = $derived((page.data as { brand?: { accent: string | null } }).brand?.accent ?? data.brand.accent);
	const brandStyle = $derived(`<style>:root{${brandVars(accent)}}</style>`);

	// Public pages: the payee's logo, else the company's, else the Bogts logo.
	// The dashboard sets its own (routes/admin/+layout.svelte).
	const isAdmin = $derived(page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/'));
	const publicIcon = $derived.by(() => {
		const d = page.data as { payee?: { logoUrl: string | null } | null; sandbox?: boolean };
		const logo = d.payee?.logoUrl ?? data.brand.logoUrl;
		return logo && !d.sandbox ? logo : faviconSvg(!!d.sandbox);
	});
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- computed hex colours only -->
	{@html brandStyle}
	{#if !isAdmin}<link rel="icon" href={publicIcon} />{/if}
</svelte:head>

{@render children()}
