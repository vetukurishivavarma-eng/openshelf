<script lang="ts">
	import Icon from './Icon.svelte';
	let { message }: { message: string } = $props();
	// An error below the fold is an error nobody sees.
	function show(el: HTMLElement) {
		el.focus({ preventScroll: true });
		el.scrollIntoView({ block: 'center' });
	}
</script>

<p class="alert" role="alert" tabindex="-1" use:show><Icon name="alert" />{message}</p>
