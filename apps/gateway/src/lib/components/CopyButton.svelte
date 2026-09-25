<script lang="ts">
	import { copyText } from '$lib/ui.svelte';
	import Icon from './Icon.svelte';

	let { value, label = 'Copy', text }: { value: string; label?: string; text?: string } = $props();
	let copied = $state(false);

	async function copy(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (await copyText(value)) {
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}
</script>

<button type="button" class="copy" class:with-text={!!text} onclick={copy} aria-label={text ? undefined : label} title={label}>
	<Icon name={copied ? 'check' : 'copy'} size={14} />{#if text}<span>{copied ? 'Copied' : text}</span>{/if}
</button>

<style>
	.copy {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 24px;
		height: 24px;
		padding: 0 4px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg-subtle);
		cursor: pointer;
		font: var(--weight-medium) var(--text-sm) var(--font-sans);
		vertical-align: middle;
	}
	.copy:hover {
		background: var(--bg-muted);
		color: var(--fg);
	}
	.with-text {
		height: var(--control-h);
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg);
		color: var(--fg);
	}
</style>
