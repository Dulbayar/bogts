<!--
	A brand's logo: the uploaded image, else a monogram of its name, else the
	Bogts logo. Decorative next to the name (the name is always shown too).
	The image is laid out by height, so a wide wordmark keeps its shape (up to
	four times as wide as it is tall); one that fails to load shows the
	monogram instead.
-->
<script lang="ts">
	import BogtsMark from './BogtsMark.svelte';

	let { src = null, name = null, size = 32 }: { src?: string | null; name?: string | null; size?: number } = $props();
	const initial = $derived(name ? Array.from(name.trim())[0]?.toUpperCase() ?? '' : '');

	/** The src that failed to load; a new src gets a fresh try. */
	let failed = $state<string | null>(null);
	const showImage = $derived(!!src && failed !== src);

	/**
	 * Attached, not an `onerror` attribute: the CSP blocks inline handlers,
	 * and this also catches a failure that happened before hydration.
	 */
	function fallBackOnError(img: HTMLImageElement) {
		const fail = () => (failed = img.getAttribute('src'));
		if (img.complete) img.decode().catch(fail);
		img.addEventListener('error', fail);
		return () => img.removeEventListener('error', fail);
	}
</script>

{#if showImage}
	<img class="logo" {src} alt="" height={size} style:--s="{size}px" {@attach fallBackOnError} />
{:else if initial}
	<span class="logo mono" style:--s="{size}px" aria-hidden="true">{initial}</span>
{:else}
	<BogtsMark {size} />
{/if}

<style>
	.logo {
		width: var(--s);
		height: var(--s);
		flex: none;
		border-radius: calc(var(--s) * 0.26);
	}
	img.logo {
		width: auto;
		min-width: var(--s);
		max-width: calc(var(--s) * 4);
		object-fit: contain;
		border-radius: calc(var(--s) * 0.16);
	}
	.mono {
		display: inline-grid;
		place-items: center;
		background: var(--accent);
		color: var(--fg-on-accent);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			inset 0 -1px 0 rgb(0 0 0 / 0.12);
		font-family: var(--font-display);
		font-weight: var(--weight-semibold);
		font-size: calc(var(--s) * 0.56);
		line-height: 1;
	}
</style>
