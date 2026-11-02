<script lang="ts">
	import { BRAND } from '$lib/brand';
	import Alert from '$lib/ui/Alert.svelte';
	let { form } = $props();
</script>

<svelte:head><title>Sign in · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>Sign in</h1>
	<p>Test version. Use any email you like and the tester password you were given.</p>
	{#if form?.error}<Alert message={form.error} />{/if}
	<form method="post">
		<label>Email <input name="email" type="email" required autocomplete="email" defaultValue={form?.email ?? ''} /></label>
		<label>Tester password <input name="password" type="password" required autocomplete="current-password" /></label>
		<button class="btn primary wide">Sign in</button>
	</form>
</div>
