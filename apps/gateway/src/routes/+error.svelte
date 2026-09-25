<!-- The public error page (404 and others), in the payer's language, with the company brand. -->
<script lang="ts">
	import { page } from '$app/state';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import PublicState from '$lib/components/public/PublicState.svelte';
	import { DEFAULT_LOCALE, isLocale, notFoundTitleKey, translator } from '$lib/i18n/public';

	type RootData = { locale?: string; brand?: { companyName: string | null; logoUrl: string | null; supportEmail: string | null; supportUrl: string | null } };
	const root = $derived(page.data as RootData);
	const locale = $derived(isLocale(root.locale) ? root.locale : DEFAULT_LOCALE);
	const t = $derived(translator(locale));
	const brand = $derived(root.brand);
	const payee = $derived(
		brand?.companyName
			? { name: brand.companyName, logoUrl: brand.logoUrl, supportEmail: brand.supportEmail, supportUrl: brand.supportUrl }
			: null
	);
	const notFound = $derived(page.status === 404);
	const notFoundTitle = $derived(t(notFoundTitleKey(page.url.pathname)));
</script>

<svelte:head>
	<title>{notFound ? notFoundTitle : t('error.generic.title')}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<PublicShell {payee} {locale} {t}>
	{#snippet summary()}
		<div class="wrap">
			{#if notFound}
				<PublicState kind="missing" title={notFoundTitle}>
					<p>{t('error.notFound.body')}</p>
				</PublicState>
			{:else}
				<PublicState kind="error" title={t('error.generic.title')}>
					<p>{t('error.generic.body')}</p>
					<a class="btn lg" href={page.url.pathname} rel="external">{t('error.retry')}</a>
				</PublicState>
			{/if}
		</div>
	{/snippet}
</PublicShell>

<style>
	.wrap {
		padding-top: var(--space-10);
	}
</style>
