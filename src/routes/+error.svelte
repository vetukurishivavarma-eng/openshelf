<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { page } from '$app/state';
	import Empty from '$lib/ui/Empty.svelte';
</script>

<svelte:head><title>{page.status} · {BRAND.name}</title></svelte:head>
<div class="page">
	<Empty icon="book" title={page.status === 404 ? 'That page is not on the shelf' : 'Something went wrong'}>
		<p>{page.error?.message}</p>
		<a class="btn" href="/books">Back to browsing</a>
	</Empty>
</div>
