<script lang="ts">
	import { page } from '$app/state';

	let { title }: { title: string } = $props();
	const mode = $derived((page.data as { env?: { mode?: string } }).env?.mode);
	const prefix = $derived(mode === 'sandbox' || mode === 'mixed' ? '[Sandbox] ' : '');
</script>

<svelte:head>
	<title>{prefix}{title} · Bogts</title>
</svelte:head>
