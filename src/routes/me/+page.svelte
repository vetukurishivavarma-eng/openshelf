<script lang="ts">
	import { BRAND } from '$lib/brand';
	import Icon from '$lib/ui/Icon.svelte';
	let { data, form } = $props();
	const p = $derived(data.profile);
</script>

<svelte:head><title>Profile · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>Profile</h1>
	<p>Signed in as {p.email}. Other readers see your city. Your name stays off every public page.</p>

	{#if form?.error}<p class="alert" role="alert"><Icon name="alert" />{form.error}</p>{/if}
	{#if form?.saved}<p class="note" role="status"><Icon name="check" />Saved.</p>{/if}
	{#if !p.city || !p.whatsapp}<p class="note"><Icon name="clock" />One step left: complete your profile before listing or requesting a book.</p>{/if}

	<form method="post" action="?/save">
		<label>Name <input name="name" required maxlength="100" autocomplete="name" value={p.name} /></label>
		<label>City <input name="city" required maxlength="60" value={p.city ?? ''} /></label>
		<label>
			Pincode
			<small>6 digits. Never shown to other readers.</small>
			<input name="pincode" required inputmode="numeric" pattern="[1-9][0-9]{'{'}5{'}'}" autocomplete="postal-code" value={p.pincode ?? ''} />
		</label>
		<label>
			WhatsApp number (10 digits)
			<small>Shared only with the other reader, and only once an order is accepted.</small>
			<input name="whatsapp" required inputmode="tel" autocomplete="tel-national" value={p.whatsapp ?? ''} />
		</label>
		<button class="btn primary wide">Save</button>
	</form>

	<form method="post" action="/logout"><button class="btn quiet"><Icon name="out" />Sign out</button></form>

	<section class="danger">
		<h2>Delete account</h2>
		<p>
			This removes your listings and your notes, refunds orders that have not left yet, and anonymises
			your account. This cannot be undone.
		</p>
		<form method="post" action="?/delete">
			<label class="choice"><input type="checkbox" name="confirm" required /><span>I understand</span></label>
			<button class="btn">Delete my account</button>
		</form>
	</section>
</div>
