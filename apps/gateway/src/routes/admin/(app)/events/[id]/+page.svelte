<script lang="ts">
	import { enhance } from '$app/forms';
	import Callout from '$lib/components/Callout.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import IdChip from '$lib/components/IdChip.svelte';
	import JsonViewer from '$lib/components/JsonViewer.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import Time from '$lib/components/Time.svelte';
	import Title from '$lib/components/Title.svelte';
	import { errorClass, responseTone } from '$lib/delivery';
	import { formatFuture, plural, truncateMiddle } from '$lib/format';
	import { deliveryStatus, eventTypeTone } from '$lib/status';
	import { clock, toast } from '$lib/ui.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const ev = $derived(data.event);
	const d = $derived(data.delivery);
	const attempts = $derived(data.attempts ?? []);
	let selectedId = $state<string | null>(null);
	const selected = $derived(attempts.find((a) => a.id === selectedId) ?? attempts[0] ?? null);
	let busy = $state(false);
	let panel: HTMLElement | undefined = $state();

	const TRUNCATED = 2048;
	const isTruncated = (body: string | null) => !!body && new TextEncoder().encode(body).byteLength >= TRUNCATED;
	const duration = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

	function pick(id: string) {
		selectedId = id;
		if (window.matchMedia('(max-width: 959px)').matches) panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/** The signature value truncated in the middle: `t=…,v1=abcd…wxyz`. */
	function shortSig(sig: string) {
		return sig.replace(/v1=([0-9a-f]+)/, (_, h: string) => `v1=${truncateMiddle(h, 8, 8)}`);
	}
</script>

<Title title={ev.type} />

<header class="detail-head">
	<div class="eyebrow">Event</div>
	<div class="title-row">
		<h1 class="text mono tone-{eventTypeTone(ev.type)}">{ev.type}</h1>
		{#if d}<StatusBadge status={deliveryStatus(d.state)} />{/if}
		<span class="spacer"></span>
		<form
			method="POST"
			action="?/redeliver"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					busy = false;
					if (result.type === 'failure') {
						toast(typeof result.data?.error === 'string' ? result.data.error : 'Re-delivery failed', 'danger');
						return;
					}
					if (result.type === 'error') {
						toast('Something went wrong. Try again.', 'danger');
						return;
					}
					toast('Re-delivery queued');
					await update();
				};
			}}
		>
			<button type="submit" class="btn" disabled={busy} title="Projects process each event.id once">
				{busy ? 'Re-delivering…' : 'Re-deliver'}
			</button>
		</form>
	</div>
	<p class="sub meta">
		<IdChip id={ev.id} />
		<span>· <a href="/admin/projects/{data.project.id}">{data.project.name}</a></span>
		<span>· subject <IdChip id={ev.subjectId} href={ev.subjectHref} /></span>
		<span>· <Time at={ev.createdAt} mode="detail" /></span>
	</p>
</header>

<div class="stack">
	{#if d && (d.state === 'retrying' || d.state === 'failed')}
		<Callout tone={d.state === 'failed' ? 'danger' : 'warning'}>
			{#if d.state === 'retrying' && d.nextAttemptAt && d.nextAttemptAt > clock.now}
				Next attempt {formatFuture(d.nextAttemptAt, clock.now)} (#{d.attempts + 1}).
			{:else if d.state === 'retrying'}
				Next attempt is due (#{d.attempts + 1}).
			{:else if d.state === 'failed'}
				Gave up after {plural(d.attempts, 'attempt', 'attempts')}.
			{:else}
				Retrying.
			{/if}
		</Callout>
	{:else if d?.state === 'skipped'}
		<Callout tone="warning">
			Not sent: the project has no webhook URL. <a href="/admin/projects/{data.project.id}?tab=webhook">Set one</a>, then re-deliver.
		</Callout>
	{/if}

	{#if attempts.length > 0 && selected}
		<div class="split">
			<section class="card attempts">
				<header><h2>Deliveries</h2></header>
				<ul>
					{#each attempts as a (a.id)}
						<li>
							<button type="button" class:active={selected.id === a.id} aria-pressed={selected.id === a.id} onclick={() => pick(a.id)}>
								<span class="dot tone-{a.succeeded ? 'success' : 'danger'}" aria-hidden="true">●</span>
								<span class="mono">#{a.number}</span>
								<span class="mono tone-{responseTone(a.httpStatus, a.error)}">{a.httpStatus ?? errorClass(a.error) ?? '—'}</span>
								<span class="subtle">{duration(a.durationMs)}</span>
								<span class="subtle time"><Time at={a.createdAt} /></span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
			<section class="card" bind:this={panel}>
				<header>
					<h2>Attempt #{selected.number}</h2>
					<StatusBadge status={deliveryStatus(selected.succeeded ? 'succeeded' : 'failed')} />
				</header>
				<dl class="kv">
					{#if selected.url}<div><dt>URL</dt><dd class="mono">{selected.url}</dd></div>{/if}
					<div>
						<dt>Response</dt>
						<dd>
							{#if selected.httpStatus}<span class="mono">{selected.httpStatus}</span>{/if}
							{#if errorClass(selected.error, selected.httpStatus)}<span class="tone-danger">{errorClass(selected.error, selected.httpStatus)}</span>{/if}
						</dd>
					</div>
					<div><dt>Duration</dt><dd>{duration(selected.durationMs)}</dd></div>
					<div><dt>Sent</dt><dd><Time at={selected.createdAt} mode="detail" />{#if selected.trigger} · {selected.trigger}{/if}</dd></div>
					{#if selected.signature}
						<div>
							<dt>Bogts-Signature</dt>
							<dd><span class="mono" title={selected.signature}>{shortSig(selected.signature)}</span><CopyButton value={selected.signature} label="Copy signature" /></dd>
						</div>
					{/if}
				</dl>
				{#if selected.responseBody}
					<div class="body-pad">
						<JsonViewer text={selected.responseBody} title={isTruncated(selected.responseBody) ? 'Response body (truncated)' : 'Response body'} />
					</div>
				{/if}
			</section>
		</div>
	{:else if d}
		<section class="card">
			<header>
				<h2>Delivery</h2>
			</header>
			<dl class="kv">
				<div><dt>URL</dt><dd class="mono">{data.project.webhookUrl ?? 'Not set'}</dd></div>
				<div><dt>Attempts</dt><dd>{d.attempts}</dd></div>
				{#if d.lastStatus || d.lastError}
					<div>
						<dt>Last response</dt>
						<dd>
							{#if d.lastStatus}<span class="mono">{d.lastStatus}</span>{/if}
							{#if errorClass(d.lastError, d.lastStatus)}<span class="tone-{responseTone(d.lastStatus, d.lastError)}">{errorClass(d.lastError, d.lastStatus)}</span>{/if}
						</dd>
					</div>
				{/if}
				{#if d.lastDurationMs !== null}<div><dt>Duration</dt><dd>{duration(d.lastDurationMs)}</dd></div>{/if}
				{#if d.deliveredAt}<div><dt>Delivered</dt><dd><Time at={d.deliveredAt} mode="detail" /></dd></div>{/if}
			</dl>
			{#if d.lastResponseBody}
				<div class="body-pad">
					<JsonViewer text={d.lastResponseBody} title={isTruncated(d.lastResponseBody) ? 'Response body (truncated)' : 'Response body'} />
				</div>
			{/if}
		</section>
	{/if}

	<JsonViewer value={ev.payload} title="Payload" />
</div>

<style>
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.split {
		display: grid;
		grid-template-columns: var(--detail-aside-w) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.attempts ul {
		list-style: none;
		margin: 0;
		padding: var(--space-1);
	}
	.attempts button {
		display: grid;
		grid-template-columns: 12px 32px 64px 1fr auto;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		min-height: 36px;
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--fg);
		font: var(--text-sm) var(--font-sans);
		text-align: left;
		cursor: pointer;
	}
	.attempts button:hover,
	.attempts button.active {
		background: var(--bg-muted);
	}
	.dot {
		font-size: 10px;
	}
	.time {
		font-size: var(--text-xs);
	}
	.kv dd span + span {
		margin-left: var(--space-2);
	}
	.body-pad {
		padding: 0 var(--space-4) var(--space-4);
	}
	@media (max-width: 959px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
