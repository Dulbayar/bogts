<script lang="ts">
	import { providerName } from '$lib/status';

	let { provider, method, test = false }: { provider: string; method?: string | null; test?: boolean } = $props();
</script>

<span class="tag">{providerName(provider)}{#if method}&nbsp;· {method}{/if}</span>{#if test}&nbsp;<span class="tag test">TEST</span>{/if}
