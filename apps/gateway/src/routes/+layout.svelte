<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { brandVars } from '$lib/brand';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	// Validated hex values only (lib/brand.ts), so inlining them is safe. app.css maps
	// these onto the light and dark theme tokens.
	const brandStyle = $derived(`<style>:root{${brandVars(data.brand?.accent)}}</style>`);
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- computed hex colours only -->
	{@html brandStyle}
</svelte:head>

{@render children()}
