<script lang="ts">
	import { BRAND } from '$lib/brand';
	import Alert from '$lib/ui/Alert.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	let { data, form } = $props();
	const p = $derived(data.profile);
</script>

<svelte:head><title>Profile · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>Profile</h1>
	<p>Signed in as {p.email}. Other readers see your city. Your name stays off every public page.</p>

	{#if form?.error}<Alert message={form.error} />{/if}
	{#if form?.saved}<p class="note" role="status"><Icon name="check" />Saved.</p>{/if}
	{#if !p.city || !p.whatsapp}<p class="note"><Icon name="clock" />One step left: complete your profile before listing or requesting a book.</p>{/if}

	<form method="post" action="?/save">
		<label>Name <input name="name" required maxlength="100" autocomplete="name" defaultValue={form?.name ?? p.name} /></label>
		<label>City <input name="city" required maxlength="40" defaultValue={form?.city ?? p.city ?? ''} /></label>
		<label>
			Pincode
			<small>6 digits. Never shown to other readers.</small>
			<input name="pincode" required inputmode="numeric" pattern="[1-9][0-9]{'{'}5{'}'}" autocomplete="postal-code" defaultValue={form?.pincode ?? p.pincode ?? ''} />
		</label>
		<label>
			WhatsApp number (10 digits)
			<small>Shared only with the other reader, and only once an order is accepted.</small>
			<input name="whatsapp" required inputmode="tel" autocomplete="tel-national" defaultValue={form?.whatsapp ?? p.whatsapp ?? ''} />
		</label>
		<button class="btn primary wide">Save</button>
	</form>

	<div class="actions">
		<form method="post" action="/logout"><button class="btn quiet"><Icon name="out" />Sign out</button></form>
		<form method="post" action="?/everywhere"><button class="btn quiet">Sign out everywhere</button></form>
	</div>

	<section class="danger">
		<h2>Delete account</h2>
		<p>
			This removes your listings and your notes, refunds orders the giver has not accepted, and anonymises
			your account. If a courier has a book for one of your orders, wait until it has arrived. This cannot
			be undone, and your monthly order count carries over if you sign up again.
		</p>
		<form method="post" action="?/delete">
			<label class="choice"><input type="checkbox" name="confirm" required /><span>I understand</span></label>
			<button class="btn">Delete my account</button>
		</form>
	</section>
</div>
