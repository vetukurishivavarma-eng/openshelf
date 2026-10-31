<script lang="ts">
	import { coverUrl } from '$lib/labels';
	// A cloth binding is typeset underneath; the Open Library cover, when there is one, sits on top.
	// Open Library answers missing covers with a transparent pixel, so the binding shows through,
	// and it is also what a slow connection sees until the image arrives.
	let { title, author, isbn }: { title: string; author: string; isbn?: string | null } = $props();
	const cloth = $derived([...title].reduce((n, c) => n + c.charCodeAt(0), 0) % 4);
</script>

<div class="cover cloth-{cloth}">
	<div aria-hidden="true"><b>{title}</b><span>{author}</span></div>
	{#if isbn}<img src={coverUrl(isbn)} alt="" loading="lazy" width="180" height="270" />{/if}
</div>
