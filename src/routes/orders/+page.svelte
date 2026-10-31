<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { ORDER_STATUS } from '$lib/labels';
	import Empty from '$lib/ui/Empty.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	let { data } = $props();

	// Only states where the viewer alone can move things on. The order page has the full story.
	const yourMove = (o: Record<string, unknown>) =>
		(o.status === 'paid' && o.mine) ||
		(!o.mine && (o.status === 'requested' || o.status === 'delivered'));
</script>

<svelte:head><title>Orders · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>Orders</h1>
	{#if data.orders.length === 0}
		<Empty icon="swap" title="No orders yet">
			<p>Ask for a book, or give one of yours. Every order, in or out, shows up here with what to do next.</p>
			<div class="actions">
				<a class="btn primary" href="/books">Find your next read</a>
				<a class="btn" href="/list">Give a book</a>
			</div>
		</Empty>
	{:else}
		<ul class="rows">
			{#each data.orders as o (o.id)}
				<li>
					<a href="/orders/{o.id}">
						<span class="row-main">
							<b>{o.title}</b>
							<span class="typed">{o.mine ? 'Your book' : 'You requested'}, {o.method === 'post' ? 'by courier' : 'handover'}</span>
						</span>
						<span class="tag" class:hot={yourMove(o)}>{yourMove(o) ? 'Your move' : ORDER_STATUS[o.status]}</span>
						<Icon name="arrow" />
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
