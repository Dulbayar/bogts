<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Title from '$lib/components/Title.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let show = $state(false);
	let busy = $state(false);
</script>

<Title title="Sign in" />

<div class="page">
	{#if data.access}
		<div class="card login">
			<h1>{data.host}</h1>
			<p>Sign in through Cloudflare Access.</p>
		</div>
	{:else}
		<form
			class="card login"
			method="POST"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update();
				};
			}}
		>
			<h1>{data.host}</h1>
			<div class="field">
				<label for="password">Password</label>
				<div class="pw">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="password"
						name="password"
						type={show ? 'text' : 'password'}
						class="input lg"
						autocomplete="current-password"
						required
						autofocus
						aria-invalid={form?.error ? 'true' : undefined}
						aria-describedby={form?.error ? 'pw-error' : undefined}
					/>
					<button type="button" class="btn ghost sm eye" aria-label={show ? 'Hide password' : 'Show password'} onclick={() => (show = !show)}>
						<Icon name={show ? 'eyeOff' : 'eye'} />
					</button>
				</div>
				{#if form?.error}<p class="error" id="pw-error" role="alert">{form.error}</p>{/if}
			</div>
			<button type="submit" class="btn primary lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
		</form>
	{/if}
</div>

<style>
	.page {
		min-height: calc(100dvh - 32px);
		display: grid;
		place-items: center;
		padding: var(--space-4);
	}
	.login {
		width: min(360px, 100%);
		display: grid;
		gap: var(--space-5);
		padding: var(--space-6);
	}
	h1 {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		overflow-wrap: anywhere;
	}
	.pw {
		position: relative;
	}
	.pw .input {
		padding-right: 40px;
	}
	.eye {
		position: absolute;
		right: 4px;
		top: 6px;
	}
</style>
