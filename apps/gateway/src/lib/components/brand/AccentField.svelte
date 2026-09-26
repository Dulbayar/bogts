<!--
	The accent colour: a swatch picker and a hex field that stay in sync, and
	a live preview of the pay page's button and link in light and dark, as the
	palette in lib/brand.ts will render them (adjusted for AA contrast).
-->
<script lang="ts">
	import { accentReport, DEFAULT_ACCENT, normalizeHex, palette, type AccentSet } from '$lib/brand';
	import Icon from '../Icon.svelte';

	let { value = '', name = 'accentColor' }: { value?: string; name?: string } = $props();

	// The form field starts from the saved value; later edits are local until Save.
	// svelte-ignore state_referenced_locally
	let hex = $state(value);
	const valid = $derived(hex.trim() === '' ? DEFAULT_ACCENT : normalizeHex(hex));
	const p = $derived(palette(valid));
	const report = $derived(accentReport(valid));
	const aa = (r: number) => r >= 4.5;
	const allGood = $derived(aa(report.light.button) && aa(report.light.link) && aa(report.dark.button) && aa(report.dark.link));

	const vars = (set: AccentSet) =>
		`--accent:${set.accent};--accent-hover:${set.accentHover};--fg-on-accent:${set.onAccent};--accent-text:${set.accentText};--accent-subtle:${set.accentSubtle};--accent-border:${set.accentBorder}`;
	const fmt = (r: number) => `${r.toFixed(1)}:1`;
</script>

<div class="accent-field">
	<div class="inputs">
		<input
			type="color"
			class="swatch"
			aria-label="Pick the accent colour"
			value={valid ?? DEFAULT_ACCENT}
			oninput={(e) => (hex = e.currentTarget.value)}
		/>
		<input
			id="accent"
			{name}
			class="input mono hex"
			bind:value={hex}
			placeholder={DEFAULT_ACCENT}
			maxlength="7"
			spellcheck="false"
			autocomplete="off"
			aria-invalid={valid ? undefined : 'true'}
			aria-describedby="accent-note"
		/>
		{#if hex.trim() !== ''}
			<button type="button" class="btn sm ghost" onclick={() => (hex = '')}>Use Bogts blue</button>
		{/if}
	</div>

	{#if valid}
		<div class="previews" aria-hidden="true">
			{#each [['light', p.light], ['dark', p.dark]] as const as [mode, set] (mode)}
				<div class="preview {mode}" style={vars(set)}>
					<span class="btnp">Pay ₮49,000</span>
					<span class="linkp">Support site</span>
				</div>
			{/each}
		</div>
		<p id="accent-note" class="note" class:good={allGood}>
			{#if allGood}
				<Icon name="check" size={14} />
				<span
					title="Button {fmt(report.light.button)} light, {fmt(report.dark.button)} dark · Link {fmt(report.light.link)} light, {fmt(report.dark.link)} dark"
					>{report.adjusted ? 'Readable in light and dark (shade adjusted where needed)' : 'Readable in light and dark'}</span
				>
			{/if}
		</p>
	{:else}
		<p id="accent-note" class="note bad" role="alert">Use a hex colour such as {DEFAULT_ACCENT}.</p>
	{/if}
</div>

<style>
	.accent-field {
		display: grid;
		gap: var(--space-3);
	}
	.inputs {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.swatch {
		width: 40px;
		height: var(--control-h);
		padding: 2px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background: var(--bg);
		cursor: pointer;
	}
	.swatch::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	.swatch::-webkit-color-swatch {
		border: 0;
		border-radius: 4px;
	}
	.swatch::-moz-color-swatch {
		border: 0;
		border-radius: 4px;
	}
	.hex {
		width: 120px;
	}
	.previews {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.preview {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-4);
		font-size: var(--text-sm);
	}
	.preview.light {
		background: #ffffff;
		color: #14191a;
	}
	.preview.dark {
		background: #161b1c;
		color: #e9eeee;
	}
	.btnp {
		display: inline-flex;
		align-items: center;
		height: 32px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		background: var(--accent);
		color: var(--fg-on-accent);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}
	.linkp {
		color: var(--accent-text);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.note {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		min-height: 20px;
		font-size: var(--text-sm);
		color: var(--fg-muted);
	}
	.note.good :global(.icon) {
		color: var(--success-fg);
	}
	.note.bad {
		color: var(--danger-fg);
	}
	@media (max-width: 480px) {
		.previews {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
