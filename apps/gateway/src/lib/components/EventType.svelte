<script lang="ts">
	import { eventTypeTone } from '$lib/status';

	let { type }: { type: string } = $props();
</script>

<span class="mono tone-{eventTypeTone(type)}">{type}</span>
