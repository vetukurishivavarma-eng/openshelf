<script lang="ts">
	import { BRAND } from '$lib/brand';
	import Alert from '$lib/ui/Alert.svelte';
	let { form } = $props();
</script>

<svelte:head><title>Erase your data · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>This account has been banned</h1>
	<p>You can no longer use {BRAND.name}, but you can still erase your personal data. The ban itself stays on record.</p>
	{#if form?.error}<Alert message={form.error} />{/if}
	<form method="post">
		<label class="choice"><input type="checkbox" name="confirm" required /><span>Erase my data</span></label>
		<button class="btn">Erase my data</button>
	</form>
</div>
