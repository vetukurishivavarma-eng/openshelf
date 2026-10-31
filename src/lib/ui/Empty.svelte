<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	let { icon, title, children }: { icon: string; title: string; children: Snippet } = $props();
</script>

<div class="empty">
	<Icon name={icon} />
	<h2>{title}</h2>
	{@render children()}
</div>
