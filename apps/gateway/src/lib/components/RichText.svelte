<!-- Renders `**bold**` and `` `code` `` in a short, trusted sentence (no HTML). -->
<script lang="ts">
	let { text }: { text: string } = $props();
	const parts = $derived(
		text
			.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
			.filter(Boolean)
			.map((p) =>
				p.startsWith('**') ? { kind: 'b', value: p.slice(2, -2) } : p.startsWith('`') ? { kind: 'c', value: p.slice(1, -1) } : { kind: 't', value: p }
			)
	);
</script>

{#each parts as p, i (i)}{#if p.kind === 'b'}<strong>{p.value}</strong>{:else if p.kind === 'c'}<code>{p.value}</code>{:else}{p.value}{/if}{/each}
