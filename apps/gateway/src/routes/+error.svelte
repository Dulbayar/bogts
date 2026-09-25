<script lang="ts">
	import { page } from '$app/state';
	import PublicShell from '$lib/components/PublicShell.svelte';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Not found' : 'Error'}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<PublicShell>
	<section class="state">
		<h1>{page.status === 404 ? (page.error?.message ?? 'Not found') : 'Something went wrong'}</h1>
		<p class="muted">{page.status === 404 ? 'Check the link, or go back and start again.' : 'Try again in a moment.'}</p>
	</section>
</PublicShell>

<style>
	.state {
		display: grid;
		gap: var(--space-2);
		text-align: center;
		margin-top: var(--space-12);
	}
	h1 {
		font-size: var(--text-xl);
		font-weight: var(--weight-semibold);
	}
</style>
