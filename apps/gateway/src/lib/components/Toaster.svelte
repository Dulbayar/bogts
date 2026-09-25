<script lang="ts">
	import { dismiss, ui } from '$lib/ui.svelte';
	import Icon from './Icon.svelte';
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">{ui.announcement}</div>
<div class="toasts" aria-live="polite">
	{#each ui.toasts as t (t.id)}
		<div class="toast {t.tone}" role={t.tone === 'danger' ? 'alert' : 'status'}>
			<Icon name={t.tone === 'danger' ? 'x' : 'check'} size={14} />
			<span>{t.text}</span>
			<button type="button" class="btn ghost sm" aria-label="Dismiss" onclick={() => dismiss(t.id)}>
				<Icon name="x" size={14} />
			</button>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		right: var(--space-4);
		bottom: var(--space-4);
		display: grid;
		gap: var(--space-2);
		z-index: 50;
		max-width: calc(100vw - 32px);
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
		background: var(--fg);
		color: var(--bg);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		font-size: var(--text-sm);
		animation: rise var(--dur-base) var(--ease);
	}
	.toast.danger :global(.icon:first-child) {
		color: var(--danger-solid);
	}
	.toast .btn {
		color: inherit;
	}
	.toast .btn:hover {
		background: transparent;
		opacity: 0.7;
	}
	@keyframes rise {
		from {
			transform: translateY(8px);
			opacity: 0;
		}
	}
	@media (max-width: 639px) {
		.toasts {
			left: 50%;
			right: auto;
			transform: translateX(-50%);
		}
	}
</style>
