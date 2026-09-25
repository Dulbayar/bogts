<!-- The sandbox strip (ux-brief §11). Production shows nothing. -->
<script lang="ts">
	let { mode, sandbox, production }: { mode: string; sandbox: string[]; production: string[] } = $props();
</script>

{#if mode === 'sandbox'}
	<div class="banner" role="status">
		<span><strong>Sandbox</strong>: {sandbox.join(' and ')} {sandbox.length === 1 ? 'is' : 'are'} using test credentials. No real money moves.</span>
	</div>
{:else if mode === 'mixed'}
	<div class="banner" role="status">
		<span><strong>Mixed</strong>: {sandbox.join(', ')} sandbox · {production.join(', ')} production. {production.join(' and ')} payments are real.</span>
	</div>
{/if}

<style>
	.banner {
		position: sticky;
		top: 0;
		z-index: 30;
		min-height: var(--banner-h);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		flex-wrap: wrap;
		padding: 4px var(--space-4);
		background: var(--sandbox-bg);
		color: var(--sandbox-fg);
		font-size: var(--text-sm);
		text-align: center;
	}
</style>
