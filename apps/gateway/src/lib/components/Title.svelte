<script lang="ts">
	import { page } from '$app/state';

	let { title }: { title: string } = $props();
	const mode = $derived((page.data as { env?: { mode?: string } }).env?.mode);
	const brand = $derived((page.data as { brand?: { companyName?: string | null } }).brand?.companyName || 'Bogts');
	const prefix = $derived(mode === 'sandbox' || mode === 'mixed' ? '[Sandbox] ' : '');
</script>

<svelte:head>
	<title>{prefix}{title} · {brand}</title>
</svelte:head>
