<!--
	The Bogts mark: a drawstring coin pouch (богц) with a square-holed coin.
	The pouch takes `currentColor`; the tie and the coin are brass.
-->
<script lang="ts">
	let { size = 24, label }: { size?: number; label?: string } = $props();
</script>

<svg
	class="bogts-mark"
	width={size}
	height={size}
	viewBox="0 0 32 32"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<path
		class="neck"
		d="M11.6 12.6 9.7 7.3c-.3-.9.6-1.6 1.4-1.2l2.3 1.1L16 5l2.6 2.2 2.3-1.1c.8-.4 1.7.3 1.4 1.2l-1.9 5.3z"
		fill="currentColor"
		opacity="0.72"
	/>
	<path
		class="body"
		d="M11 12.4c-4.5 2.9-6 7.4-5.4 11 .7 4.2 4.8 5.9 10.4 5.9s9.7-1.7 10.4-5.9c.6-3.6-.9-8.1-5.4-11z"
		fill="currentColor"
	/>
	<rect class="tie" x="9.6" y="10.9" width="12.8" height="3.1" rx="1.55" fill="var(--brass, #b8862b)" />
	<circle class="coin" cx="16" cy="21.6" r="4.3" fill="var(--brass, #b8862b)" />
	<rect x="14.55" y="20.15" width="2.9" height="2.9" rx="0.4" fill="currentColor" />
</svg>

<style>
	.bogts-mark {
		display: inline-block;
		flex: none;
		vertical-align: middle;
	}
</style>
