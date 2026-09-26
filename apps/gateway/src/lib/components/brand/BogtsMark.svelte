<!--
	The Bogts logo: the blue coin pouch tied with an orange cord, in its own
	colours on any background (never the company accent). Drawn in favicon.ts.
-->
<script lang="ts">
	import { MARK_SVG, MARK_VIEWBOX } from './favicon';

	let { size = 24, label }: { size?: number; label?: string } = $props();
</script>

<svg
	class="bogts-mark"
	width={size}
	height={size}
	viewBox={MARK_VIEWBOX}
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a constant in this repo -->
	{@html MARK_SVG}
</svg>

<style>
	.bogts-mark {
		display: inline-block;
		flex: none;
		vertical-align: middle;
	}
</style>
