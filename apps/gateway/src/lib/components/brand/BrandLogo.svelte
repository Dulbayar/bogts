<!--
	A brand's logo: the uploaded image, else a monogram of its name, else the
	Bogts pouch. Decorative next to the name (the name is always shown too).
-->
<script lang="ts">
	import BogtsMark from './BogtsMark.svelte';

	let { src = null, name = null, size = 32 }: { src?: string | null; name?: string | null; size?: number } = $props();
	const initial = $derived(name ? Array.from(name.trim())[0]?.toUpperCase() ?? '' : '');
</script>

{#if src}
	<img class="logo" {src} alt="" width={size} height={size} style:--s="{size}px" />
{:else if initial}
	<span class="logo mono" style:--s="{size}px" aria-hidden="true">{initial}</span>
{:else}
	<span class="logo mark" style:--s="{size}px"><BogtsMark size={Math.round(size * 0.78)} /></span>
{/if}

<style>
	.logo {
		width: var(--s);
		height: var(--s);
		flex: none;
		border-radius: calc(var(--s) * 0.26);
	}
	img.logo {
		object-fit: contain;
	}
	.mono,
	.mark {
		display: inline-grid;
		place-items: center;
		background: var(--accent);
		color: var(--fg-on-accent);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.18),
			inset 0 -1px 0 rgb(0 0 0 / 0.12);
	}
	.mono {
		font-family: var(--font-display);
		font-weight: var(--weight-semibold);
		font-size: calc(var(--s) * 0.56);
		line-height: 1;
	}
</style>
