<!--
	A modal on the native <dialog> (focus trap, Esc, focus return for free).
	Esc, ✕ and the backdrop close it only while `dismissible` and not `busy`.
	Under 480px it is a bottom sheet.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		dismissible = true,
		busy = false,
		initialFocus,
		children,
		footer,
		onclose
	}: {
		open?: boolean;
		title: string;
		dismissible?: boolean;
		busy?: boolean;
		/** CSS selector of the element to focus first */
		initialFocus?: string;
		children: Snippet;
		footer?: Snippet;
		/** Called after the dialog closes, however it was closed */
		onclose?: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	const titleId = `modal-${Math.random().toString(36).slice(2, 9)}`;
	const canClose = $derived(dismissible && !busy);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			const target = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null;
			target?.focus();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	function onCancel(e: Event) {
		e.preventDefault();
		if (canClose) open = false;
	}

	function onBackdrop(e: MouseEvent) {
		if (e.target === dialog && canClose) open = false;
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	oncancel={onCancel}
	onclose={() => {
		// Browsers may force-close on a repeated Esc; a non-dismissible dialog reopens.
		if (open && !canClose) {
			dialog?.showModal();
			return;
		}
		open = false;
		onclose?.();
	}}
	onclick={onBackdrop}
>
	<div class="panel">
		<header>
			<h2 id={titleId}>{title}</h2>
			{#if dismissible}
				<button type="button" class="btn ghost sm close" aria-label="Close" disabled={!canClose} onclick={() => (open = false)}>
					<Icon name="x" />
				</button>
			{/if}
		</header>
		<div class="content">{@render children()}</div>
		{#if footer}<footer>{@render footer()}</footer>{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(480px, calc(100vw - 32px));
		max-height: calc(100dvh - 64px);
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		background: var(--bg);
		color: var(--fg);
		box-shadow: var(--shadow-lg);
	}
	dialog::backdrop {
		background: var(--overlay);
	}
	.panel {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
	}
	.close {
		margin: -4px -8px -4px 0;
	}
	.content {
		display: grid;
		gap: var(--space-3);
		font-size: var(--text-md);
		min-width: 0;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	@media (max-width: 479px) {
		dialog {
			width: 100vw;
			max-width: 100vw;
			margin: auto 0 0;
			border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		}
		footer {
			flex-direction: column-reverse;
		}
		footer :global(.btn) {
			width: 100%;
			height: 40px;
		}
	}
</style>
