<script lang="ts">
	import CopyButton from './CopyButton.svelte';

	let { value, text, title = 'JSON' }: { value?: unknown; text?: string; title?: string } = $props();

	const body = $derived(text ?? JSON.stringify(value, null, 2));
	const lines = $derived(body.split('\n').length);
	let wrap = $state(false);
	let expanded = $state(false);
	const long = $derived(lines > 20);
</script>

<div class="json">
	<div class="bar">
		<span class="label">{title}</span>
		<span class="tools">
			<button type="button" class="btn ghost sm" aria-pressed={wrap} onclick={() => (wrap = !wrap)}>Wrap</button>
			<CopyButton value={body} label="Copy {title}" />
		</span>
	</div>
	<pre class:wrap class:clamped={long && !expanded}>{body}</pre>
	{#if long}
		<button type="button" class="btn ghost sm more" onclick={() => (expanded = !expanded)}>
			{expanded ? 'Show less' : 'Show all'}
		</button>
	{/if}
</div>

<style>
	.json {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg-inset);
		min-width: 0;
		overflow: hidden;
	}
	.bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 2px 4px 2px var(--space-3);
		border-bottom: 1px solid var(--border);
	}
	.label {
		font-size: var(--text-xs);
		color: var(--fg-muted);
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	pre {
		margin: 0;
		padding: var(--space-3);
		font: 12px/18px var(--font-mono);
		overflow-x: auto;
		color: var(--fg);
	}
	pre.wrap {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	pre.clamped {
		max-height: calc(20 * 18px + 24px);
		overflow-y: hidden;
		mask-image: linear-gradient(to bottom, black 75%, transparent);
	}
	.more {
		margin: 0 var(--space-2) var(--space-2);
	}
</style>
