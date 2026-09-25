<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Title from '$lib/components/Title.svelte';
	import BrandLogo from '$lib/components/brand/BrandLogo.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let show = $state(false);
	let busy = $state(false);
</script>

<Title title="Sign in" />

{#snippet head()}
	<div class="head">
		<BrandLogo src={data.brand.logoUrl} name={data.brand.companyName} size={48} />
		<div>
			<h1>{data.brand.companyName ?? 'Bogts'}</h1>
			<p class="host">{data.host}</p>
		</div>
	</div>
{/snippet}

<div class="page">
	{#if data.access}
		<div class="card login">
			{@render head()}
			<p class="muted">Sign in through Cloudflare Access.</p>
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
			{@render head()}
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
		background:
			radial-gradient(60rem 30rem at 50% -10%, color-mix(in srgb, var(--accent-subtle) 90%, transparent), transparent 70%),
			var(--bg-subtle);
	}
	.login {
		position: relative;
		width: min(380px, 100%);
		display: grid;
		gap: var(--space-5);
		padding: var(--space-8) var(--space-6) var(--space-6);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		animation: arrive 360ms var(--ease) both;
	}
	/* A key-fret (хээ) edge along the top of the card. */
	.login::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 10px;
		background: var(--accent);
		opacity: 0.35;
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='10' viewBox='0 0 16 10'%3E%3Cpath d='M0 .75h16M12.25 .75v8.5h-8.5v-5h5v2' fill='none' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E")
			repeat-x left top / 16px 10px;
		-webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='10' viewBox='0 0 16 10'%3E%3Cpath d='M0 .75h16M12.25 .75v8.5h-8.5v-5h5v2' fill='none' stroke='%23000' stroke-width='1.5'/%3E%3C/svg%3E")
			repeat-x left top / 16px 10px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.head > div {
		min-width: 0;
	}
	h1 {
		font-family: var(--font-display);
		font-size: 24px;
		line-height: 30px;
		font-weight: var(--weight-semibold);
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}
	.host {
		font-size: var(--text-sm);
		color: var(--fg-muted);
		overflow-wrap: anywhere;
	}
	.pw {
		position: relative;
	}
	.pw .input {
		padding-right: 44px;
	}
	.eye {
		position: absolute;
		right: 6px;
		top: 8px;
	}
	@keyframes arrive {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
