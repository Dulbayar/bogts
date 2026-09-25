<!-- The frame of the public pages: neutral, no admin chrome, sandbox strip when testing. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { sandbox = false, children, footer }: { sandbox?: boolean; children: Snippet; footer?: Snippet } = $props();
</script>

<div class="public">
	{#if sandbox}<div class="strip" role="status">Test payment: no real money</div>{/if}
	<main>{@render children()}</main>
	{#if footer}<footer>{@render footer()}</footer>{/if}
</div>

<style>
	.public {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--fg);
	}
	.strip {
		padding: 6px var(--space-4);
		background: var(--sandbox-bg);
		color: var(--sandbox-fg);
		font-size: var(--text-sm);
		text-align: center;
	}
	main {
		flex: 1;
		width: 100%;
		max-width: 420px;
		margin: 0 auto;
		padding: var(--space-8) var(--space-4) var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	footer {
		padding: var(--space-4);
		text-align: center;
		font-size: var(--text-xs);
		color: var(--fg-subtle);
	}
	@media (max-width: 639px) {
		main {
			padding-top: var(--space-6);
		}
	}
</style>
