<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { brandVars } from '$lib/brand';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// The dashboard layout and the login page put the branding in their own data,
	// so read the merged page data. Validated hex values only (lib/brand.ts), so
	// inlining them is safe; app.css maps them onto the light and dark tokens.
	const accent = $derived((page.data as { brand?: { accent: string | null } }).brand?.accent ?? data.brand.accent);
	const brandStyle = $derived(`<style>:root{${brandVars(accent)}}</style>`);
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- computed hex colours only -->
	{@html brandStyle}
</svelte:head>

{@render children()}
