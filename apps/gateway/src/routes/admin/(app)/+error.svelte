<script lang="ts">
	import { page } from '$app/state';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Title from '$lib/components/Title.svelte';

	const section = $derived(page.url.pathname.split('/')[2] ?? '');
	const back = $derived(section ? `/admin/${section}` : '/admin');
</script>

<Title title={page.status === 404 ? 'Not found' : 'Error'} />

{#if page.status === 404}
	<EmptyState icon="search" title="Not found">
		<p>{page.error?.message ?? 'Nothing here.'} It may belong to another deployment.</p>
		<p><a class="btn sm" href={back}>Back</a></p>
	</EmptyState>
{:else}
	<EmptyState icon="alert" title="Something went wrong">
		<p><a class="btn sm" href={page.url.pathname}>Retry</a></p>
	</EmptyState>
{/if}
