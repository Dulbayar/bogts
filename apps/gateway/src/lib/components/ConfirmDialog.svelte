<!--
	A destructive action behind a dialog (ux-brief §9.2). With `expected`, the
	danger button stays disabled until that text is typed exactly (trimmed).
	The form posts to a SvelteKit action; a failure keeps the dialog open with
	the (safe) error message.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from '$lib/ui.svelte';
	import Callout from './Callout.svelte';
	import CopyButton from './CopyButton.svelte';
	import Modal from './Modal.svelte';

	let {
		open = $bindable(false),
		title,
		action,
		expected,
		confirmLabel,
		cancelLabel,
		busyLabel,
		successMessage,
		fields = {},
		danger = true,
		children,
		onsuccess
	}: {
		open?: boolean;
		title: string;
		action: string;
		expected?: string;
		confirmLabel: string;
		cancelLabel: string;
		busyLabel?: string;
		successMessage?: string;
		fields?: Record<string, string>;
		danger?: boolean;
		children: Snippet;
		onsuccess?: (data: Record<string, unknown> | undefined) => void;
	} = $props();

	let typed = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	const inputId = `confirm-${Math.random().toString(36).slice(2, 9)}`;
	const matches = $derived(!expected || typed.trim() === expected.trim());

	function reset() {
		typed = '';
		error = null;
	}

	const submit: SubmitFunction = () => {
		busy = true;
		error = null;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'failure') {
				error = typeof result.data?.error === 'string' ? result.data.error : 'Something went wrong. Try again.';
				return;
			}
			if (result.type === 'error') {
				error = 'Something went wrong. Try again.';
				return;
			}
			open = false;
			if (successMessage) toast(successMessage);
			await update({ reset: true, invalidateAll: true });
			if (result.type === 'success') onsuccess?.(result.data);
		};
	};
</script>

<Modal bind:open {title} {busy} initialFocus={expected ? 'input' : '.safe'} onclose={reset}>
	<form method="POST" {action} use:enhance={submit} class="confirm">
		{#each Object.entries(fields) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<div class="body">{@render children()}</div>
		{#if expected}
			<div class="field">
				<label for={inputId}>Type <code>{expected}</code><CopyButton value={expected} label="Copy" /> to confirm</label>
				<input
					id={inputId}
					class="input mono"
					name="confirm"
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					bind:value={typed}
				/>
			</div>
		{/if}
		{#if error}<Callout tone="danger" role="alert">{error}</Callout>{/if}
		<div class="buttons">
			<button type="button" class="btn safe" disabled={busy} onclick={() => (open = false)}>{cancelLabel}</button>
			<button type="submit" class="btn {danger ? 'danger' : 'primary'}" disabled={!matches || busy}>
				{busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
			</button>
		</div>
	</form>
</Modal>

<style>
	.confirm {
		display: grid;
		gap: var(--space-4);
	}
	.body {
		display: grid;
		gap: var(--space-2);
		color: var(--fg-muted);
	}
	.field label {
		font-weight: var(--weight-regular);
		color: var(--fg-muted);
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}
	.field code {
		color: var(--fg);
		background: var(--bg-inset);
		padding: 1px 4px;
		border-radius: var(--radius-sm);
		overflow-wrap: anywhere;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	@media (max-width: 479px) {
		.buttons {
			flex-direction: column-reverse;
		}
		.buttons .btn {
			width: 100%;
			height: 40px;
		}
	}
</style>
