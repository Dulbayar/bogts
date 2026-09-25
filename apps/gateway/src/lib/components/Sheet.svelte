<!--
	A right-hand side sheet on the native <dialog> (480px; full width on
	mobile). Esc and the backdrop close it unless `busy`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		busy = false,
		children,
		footer
	}: { open?: boolean; title: string; busy?: boolean; children: Snippet; footer?: Snippet } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	const titleId = `sheet-${Math.random().toString(36).slice(2, 9)}`;

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			dialog.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus();
		} else if (!open && dialog.open) dialog.close();
	});

	function onCancel(e: Event) {
		e.preventDefault();
		if (!busy) open = false;
	}
	function onBackdrop(e: MouseEvent) {
		if (e.target === dialog && !busy) open = false;
	}
</script>

<dialog bind:this={dialog} aria-labelledby={titleId} oncancel={onCancel} onclose={() => (open = false)} onclick={onBackdrop}>
	<div class="panel">
		<header>
			<h2 id={titleId}>{title}</h2>
			<button type="button" class="btn ghost sm" aria-label="Close" disabled={busy} onclick={() => (open = false)}>
				<Icon name="x" />
			</button>
		</header>
		<div class="content">{@render children()}</div>
		{#if footer}<footer>{@render footer()}</footer>{/if}
	</div>
</dialog>

<style>
	dialog {
		margin: 0 0 0 auto;
		width: min(480px, 100vw);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		padding: 0;
		border: 0;
		border-left: 1px solid var(--border);
		background: var(--bg);
		color: var(--fg);
		box-shadow: var(--shadow-lg);
	}
	dialog::backdrop {
		background: var(--overlay);
	}
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}
	.content {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-5);
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--border);
	}
</style>
