<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { fmtDate } from '$lib/labels';
	import Empty from '$lib/ui/Empty.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	let { data, form } = $props();
	const STATUS: Record<string, string> = {
		available: 'Waiting for a reader',
		reserved: 'Reserved for a reader',
		gone: 'Passed on'
	};
</script>

<svelte:head><title>My shelf · {BRAND.name}</title></svelte:head>

<div class="page">
	<div class="head-row">
		<h1>My shelf</h1>
		<a class="btn primary" href="/list"><Icon name="plus" />Give a book</a>
	</div>

	{#if form?.error}<p class="alert" role="alert"><Icon name="alert" />{form.error}</p>{/if}

	{#if data.books.length === 0}
		<Empty icon="shelf" title="Your shelf is empty">
			<p>Give away the books you have finished, each with a note for the next reader.</p>
			<a class="btn primary" href="/list">Give your first book</a>
		</Empty>
	{:else}
		<ul class="cards">
			{#each data.books as b (b.id)}
				<li class="card plain">
					<div class="card-body">
						<h2><a href="/books/{b.id}">{b.title}</a></h2>
						<p class="by">{b.author}</p>
						<p class="typed">{STATUS[b.status] ?? b.status}</p>
						{#if b.status === 'available'}
							<form method="post" action="?/remove">
								<input type="hidden" name="id" value={b.id} />
								<button class="btn quiet">Remove</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="section">Books you received</h2>
	<p>{data.used} of 3 orders used this month.</p>
	{#if data.received.length === 0}
		<Empty icon="book" title="Nothing received yet">
			<p>When a book reaches you, it appears here, ready to thank the giver and pass on.</p>
		</Empty>
	{:else}
		<ul class="rows">
			{#each data.received as r (r.id)}
				<li>
					<a href="/orders/{r.id}">
						<span class="row-main">
							<b>{r.title}</b>
							<span class="typed">Received {fmtDate(r.status_at)}</span>
						</span>
						<span class="tag">{r.onward ? 'Given onward' : 'Give it onward'}</span>
						<Icon name="arrow" />
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
