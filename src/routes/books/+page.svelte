<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { CONDITION_LABEL } from '$lib/labels';
	import Cover from '$lib/ui/Cover.svelte';
	import Empty from '$lib/ui/Empty.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Stamp from '$lib/ui/Stamp.svelte';
	let { data } = $props();

	const nextHref = $derived.by(() => {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(data.filters)) if (v) p.set(k, v);
		p.set('page', String(data.page + 1));
		return `/books?${p}`;
	});
	const filtered = $derived(data.filters.q || data.filters.city || data.filters.condition);
</script>

<svelte:head><title>Browse books · {BRAND.name}</title></svelte:head>

<div class="page">
	<h1>Browse books</h1>

	<form class="filters" method="get" role="search">
		<label class="grow">Title or author <input type="search" name="q" value={data.filters.q ?? ''} /></label>
		<label>
			City
			<input name="city" list="cities" value={data.filters.city ?? ''} />
			<datalist id="cities">
				{#each data.cities as city}<option value={city}></option>{/each}
			</datalist>
		</label>
		<label>
			Condition
			<select name="condition" value={data.filters.condition ?? ''}>
				<option value="">Any</option>
				{#each Object.entries(CONDITION_LABEL) as [value, label]}<option {value}>{label}</option>{/each}
			</select>
		</label>
		<button class="btn"><Icon name="search" />Search</button>
	</form>

	{#if data.books.length === 0}
		{#if filtered}
			<Empty icon="search" title="Nothing matches yet">
				<p>
					{#if data.filters.city}No match in {data.filters.city} so far. Give a book and be among the first readers there.
					{:else}Try fewer words or another spelling, or give your own copy to the next reader.{/if}
				</p>
				<div class="actions">
					<a class="btn" href="/books">Clear search</a>
					<a class="btn primary" href="/list">Give a book</a>
				</div>
			</Empty>
		{:else}
			<Empty icon="book" title="The shelves are waiting for their first book">
				<p>{BRAND.name} has just opened. Give a book and you will be among the first readers in your city.</p>
				<a class="btn primary" href="/list">Give a book</a>
			</Empty>
		{/if}
	{:else}
		<ul class="cards">
			{#each data.books as b (b.id)}
				<li class="card">
					<Cover title={b.title} author={b.author} isbn={b.isbn} />
					<div class="card-body">
						<h2><a href="/books/{b.id}">{b.title}</a></h2>
						<p class="by">{b.author}</p>
						<p class="typed">{CONDITION_LABEL[b.condition]}</p>
					</div>
					<Stamp city={b.city} />
				</li>
			{/each}
		</ul>
	{/if}
	{#if data.more}<p class="center"><a class="btn" href={nextHref}>Next page<Icon name="arrow" /></a></p>{/if}
</div>
