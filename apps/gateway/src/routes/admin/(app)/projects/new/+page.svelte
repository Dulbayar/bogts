<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import RevealSecrets from '$lib/components/RevealSecrets.svelte';
	import Title from '$lib/components/Title.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let busy = $state(false);
	let reveal = $state(false);
	const created = $derived(form && 'created' in form ? form.created : null);
	const failure = $derived(form && 'error' in form ? form : null);
</script>

<Title title="New project" />

<div class="narrow">
	<PageHeader title="New project" />
	<form
		class="card form"
		method="POST"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				await update({ reset: false });
				if (result.type === 'success' && result.data?.created) reveal = true;
			};
		}}
	>
		<div class="field">
			<label for="name">Name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="name" name="name" class="input" required maxlength="80" autocomplete="off" autofocus value={failure?.name ?? ''} />
		</div>
		<div class="field">
			<label for="webhookUrl">Webhook URL <span class="subtle">(optional)</span></label>
			<input
				id="webhookUrl"
				name="webhookUrl"
				class="input mono"
				type="url"
				inputmode="url"
				placeholder="https://example.com/webhooks/bogts"
				autocomplete="off"
				value={failure?.webhookUrl ?? ''}
				aria-invalid={failure?.error ? 'true' : undefined}
				aria-describedby="webhook-hint"
			/>
			<span class="hint" id="webhook-hint">{data.allowLocal ? 'https://, or http://localhost in sandbox' : 'https:// only'}</span>
		</div>
		{#if failure?.error}<p class="error" role="alert">{failure.error}</p>{/if}
		<div class="actions">
			<a class="btn" href={resolve('/admin/projects')}>Cancel</a>
			<button type="submit" class="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
		</div>
	</form>
</div>

{#if created}
	<RevealSecrets
		bind:open={reveal}
		secrets={[
			{ label: 'API key', env: 'BOGTS_API_KEY', value: created.apiKey },
			{ label: 'Webhook signing secret', env: 'BOGTS_WEBHOOK_SECRET', value: created.webhookSecret }
		]}
		ondone={() => goto(resolve(`/admin/projects/${created.id}`))}
	/>
{/if}

<style>
	.narrow {
		max-width: 560px;
	}
	.form {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5);
	}
	.error {
		color: var(--danger-fg);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
