<script lang="ts">
	import { BRAND } from '$lib/brand';
	import '@fontsource/literata/latin-400.css';
	import '@fontsource/literata/latin-400-italic.css';
	import '@fontsource/literata/latin-700.css';
	import '@fontsource/courier-prime/latin-400.css';
	import '@fontsource/courier-prime/latin-700.css';
	import '../app.css';
	import { page } from '$app/state';
	import Icon from '$lib/ui/Icon.svelte';
	let { data, children } = $props();
	const here = (href: string) => (page.url.pathname.startsWith(href) ? 'page' : undefined);
	const links = $derived(
		data.user
			? [
					['/books', 'search', 'Browse'],
					['/list', 'plus', 'Give'],
					['/shelf', 'shelf', 'Shelf'],
					['/orders', 'orders', 'Orders'],
					['/me', 'user', 'Profile'],
					...(data.user.isAdmin ? [['/admin', 'admin', 'Admin']] : [])
				]
			: []
	);
</script>

<svelte:head>
	<title>{BRAND.name}</title>
	<meta name="description" content="{BRAND.tagline} Give a book you have finished, with a note for whoever reads it next." />
</svelte:head>

<a class="skip" href="#main">Skip to content</a>
{#if data.testMode}<p class="testmode" role="status">Test mode, no money moves</p>{/if}
<header class="top">
	<div class="top-in">
		<a class="brand" href="/">
			<img src="/icon.svg" alt="" width="32" height="32" /><span>{BRAND.name}</span>
		</a>
		<nav class:tabs={data.user} aria-label="Main">
			<ul>
				{#each links as [href, icon, label]}
					<li><a {href} aria-current={here(href)}><Icon name={icon} />{label}</a></li>
				{:else}
					<li><a href="/books" aria-current={here('/books')}>Browse</a></li>
					<li><a class="signin" href="/auth/google" data-sveltekit-reload>Sign in</a></li>
				{/each}
			</ul>
		</nav>
	</div>
</header>

<main id="main" class:has-tabs={data.user}>{@render children()}</main>

<footer class="foot" class:has-tabs={data.user}>
	<p>{BRAND.tagline}</p>
	<p><a href="/terms">Terms</a><a href="/privacy">Privacy</a></p>
</footer>
