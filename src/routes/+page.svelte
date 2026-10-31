<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { FEE_PAISE, rupees } from '$lib/labels';
	import Icon from '$lib/ui/Icon.svelte';
	let { data } = $props();

	// Below this a number reads as a sad boast, so the page invites instead.
	const WORTH_SHOWING = 10;
	const stats = $derived(
		(
			[
				[data.counts.books, 'books waiting for a reader'],
				[data.counts.passed, 'books passed on'],
				[data.counts.readers, 'readers']
			] as const
		).filter(([n]) => n >= WORTH_SHOWING)
	);
</script>

<svelte:head>
	<title>{BRAND.name} · {BRAND.tagline}</title>
</svelte:head>

<section class="hero page">
	<div>
		<p class="eyebrow">Free books, reader to reader</p>
		<h1>{BRAND.tagline}</h1>
		<p class="lede">
			That <span class="nb">₹500 book</span> you read once is on a shelf, waiting. Give it away with a note
			for whoever reads it next, and watch where it goes.
		</p>
		<div class="actions">
			{#if data.user}
				<a class="btn primary" href="/list">Give a book</a>
			{:else}
				<a class="btn primary" href="/auth/google" data-sveltekit-reload>Give a book</a>
			{/if}
			<a class="btn" href="/books">Find your next read<Icon name="arrow" /></a>
		</div>
	</div>

	<figure class="slip">
		<figcaption>Every book keeps its own slip</figcaption>
		<dl>
			<div><dt>First reader</dt><dd>you</dd></div>
			<div><dt>Next reader</dt><dd>someone new</dd></div>
			<div><dt>After that</dt><dd>who knows</dd></div>
			<div><dt>Your part</dt><dd class="slip-mark">Pass it on</dd></div>
		</dl>
		<p class="slip-note">Dear next reader,</p>
		<p class="slip-hint">Your note travels inside the book.</p>
	</figure>
</section>

<section class="band" aria-labelledby="how">
	<div class="page">
		<h2 id="how">How a book moves on</h2>
		<ol class="steps">
			<li>
				<h3>Give a book you have finished</h3>
				<p>List it and write a short note to the next reader. Giving is always free.</p>
			</li>
			<li>
				<h3>A reader asks for it</h3>
				<p>They pay {rupees(FEE_PAISE)} plus courier, and we arrange the pickup from you. Nearby? Collect it by hand for just {rupees(FEE_PAISE)}.</p>
			</li>
			<li>
				<h3>The journey carries on</h3>
				<p>They send you a thank-you. When they finish, they can give it onward, and the story grows.</p>
			</li>
		</ol>
	</div>
</section>

<section class="page fair" aria-labelledby="fair">
	<div>
		<h2 id="fair">A book that remembers where it has been</h2>
		<p>
			Every book shows how many readers it has had and the cities it has passed through. Never a name.
			Your number stays private until an order is confirmed, and a limit of three
			orders a month keeps resellers out.
		</p>
	</div>
	<ul class="rates">
		<li><span class="price">₹0</span><p><b>If you give</b>Nothing to pay. The courier collects, and a thank-you comes back.</p></li>
		<li><span class="price">{rupees(FEE_PAISE)}</span><p><b>If you receive</b>The book is free. You pay {rupees(FEE_PAISE)} to run {BRAND.name}, plus the courier at the quoted rate.</p></li>
	</ul>
</section>

<section class="band ink" aria-labelledby="today">
	<div class="page">
		{#if stats.length}
			<h2 id="today">On the shelves today</h2>
			<ul class="stats">
				{#each stats as [n, label]}<li><b>{n}</b>{label}</li>{/each}
			</ul>
			<p>Still early in most cities. Give one book and be among the first readers in yours.</p>
		{:else}
			<h2 id="today">The first journeys start here</h2>
			<p>
				{BRAND.name} has just opened, so there are no big numbers to show you, and we will not make any up.
				Give one book now and you will be among the first readers in your city.
			</p>
		{/if}
		{#if data.user}
			<a class="btn light" href="/list">Start a book’s journey<Icon name="arrow" /></a>
		{:else}
			<a class="btn light" href="/auth/google" data-sveltekit-reload>Start a book’s journey<Icon name="arrow" /></a>
		{/if}
	</div>
</section>
