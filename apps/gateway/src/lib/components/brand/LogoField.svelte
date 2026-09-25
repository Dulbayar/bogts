<!--
	A logo picker: the current logo (or the fallback), a file input and a
	Remove toggle. The chosen file previews through a data: URL (the CSP allows
	data: images, not blob:). The server checks the real type and size.
-->
<script lang="ts">
	import Icon from '../Icon.svelte';
	import BrandLogo from './BrandLogo.svelte';

	let {
		current = null,
		name = null,
		id = 'logo'
	}: { current?: string | null; name?: string | null; id?: string } = $props();

	let preview = $state<string | null>(null);
	let remove = $state(false);
	let problem = $state<string | null>(null);
	const MAX = 256 * 1024;
	const shown = $derived(remove ? null : (preview ?? current));

	function onPick(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		problem = null;
		if (!file) {
			preview = null;
			return;
		}
		if (file.size > MAX) {
			problem = 'This file is larger than 256 KB.';
			e.currentTarget.value = '';
			preview = null;
			return;
		}
		remove = false;
		const reader = new FileReader();
		reader.onload = () => (preview = typeof reader.result === 'string' ? reader.result : null);
		reader.readAsDataURL(file);
	}
</script>

<div class="logo-field">
	<div class="frame" class:empty={!shown}>
		<BrandLogo src={shown} {name} size={56} />
	</div>
	<div class="controls">
		<div class="buttons">
			<label class="btn sm" for={id}><Icon name="upload" size={14} /> {current || preview ? 'Replace' : 'Upload logo'}</label>
			<input {id} name="logo" type="file" accept="image/png,image/svg+xml,image/webp" class="sr-only" onchange={onPick} />
			{#if current && !preview}
				<label class="btn sm ghost remove">
					<input type="checkbox" name="removeLogo" value="1" bind:checked={remove} />
					{remove ? 'Will be removed' : 'Remove'}
				</label>
			{/if}
		</div>
		<span class="hint">PNG, SVG or WebP, up to 256 KB.</span>
		{#if problem}<span class="error" role="alert">{problem}</span>{/if}
	</div>
</div>

<style>
	.logo-field {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}
	.frame {
		display: grid;
		place-items: center;
		min-width: 76px;
		max-width: 100%;
		height: 76px;
		padding-inline: 10px;
		overflow: hidden;
		flex: none;
		border-radius: var(--radius-lg);
		border: 1px solid var(--border);
		background:
			conic-gradient(var(--bg-muted) 25%, var(--bg) 0 50%, var(--bg-muted) 0 75%, var(--bg) 0) 0 0 / 12px 12px;
	}
	.controls {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}
	.buttons {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	label.btn:has(+ input:focus-visible) {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}
	.remove input {
		accent-color: var(--danger-solid);
		margin: 0;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--fg-subtle);
	}
	.error {
		font-size: var(--text-sm);
		color: var(--danger-fg);
	}
</style>
