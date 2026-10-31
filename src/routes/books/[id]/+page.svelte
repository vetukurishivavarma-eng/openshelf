<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { CONDITION_LABEL, FEE_PAISE, rupees } from '$lib/labels';
	import Alert from '$lib/ui/Alert.svelte';
	import Cover from '$lib/ui/Cover.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Stamp from '$lib/ui/Stamp.svelte';
	import { once } from '$lib/ui/once';
	let { data, form } = $props();
	const b = $derived(data.book);
	const j = $derived(data.journey);
</script>

<svelte:head><title>{b.title} · {BRAND.name}</title></svelte:head>

<div class="page detail">
	<div class="detail-cover">
		<Cover title={b.title} author={b.author} isbn={b.isbn} />
		<Stamp city={b.city} />
	</div>

	<div>
		<h1>{b.title}</h1>
		<p class="by large">{b.author}</p>
		<dl class="facts">
			<div><dt>Condition</dt><dd>{CONDITION_LABEL[b.condition]}</dd></div>
			<div><dt>Given from</dt><dd>{b.city}</dd></div>
			{#if b.status !== 'gone'}
				<div><dt>The book</dt><dd>Free</dd></div>
				<div><dt>You pay</dt><dd>{rupees(FEE_PAISE)} plus courier{#if data.sameCity}, or {rupees(FEE_PAISE)} for a local handover{/if}</dd></div>
			{/if}
		</dl>

		<section class="journey" aria-labelledby="journey">
			<h2 id="journey">This book’s journey</h2>
			<p>{j.readers} reader{j.readers === 1 ? '' : 's'} so far</p>
			<ol class="typed">
				{#each j.cities as city}<li>{city}</li>{/each}
			</ol>
		</section>

		{#if form?.reported}<p class="note" role="status"><Icon name="check" />Thanks. An admin will look at your report.</p>{/if}

		{#if data.myOrderId}
			<p class="note">You ordered this book. <a href="/orders/{data.myOrderId}">See your order.</a></p>
		{:else if b.status === 'gone'}
			<p class="note">
				This copy has moved on to its next reader.
				{#if j.currentId}<a href="/books/{j.currentId}">See where it is now.</a>{/if}
			</p>
		{:else if b.mine}
			<p class="note">This is your listing. <a href="/shelf">Manage it on your shelf.</a></p>
		{:else if b.status === 'reserved'}
			<p class="note">This book is reserved for another reader.</p>
		{:else if !data.signedIn}
			<a class="btn primary wide" href="/auth/google" data-sveltekit-reload>Sign in to request this book</a>
		{:else if data.ordersLeft === 0}
			<p class="note">You have used your 3 orders this month. The limit resets on the 1st.</p>
		{:else}
			<form id="order" method="post" action="?/request#order" use:once>
				{#if form?.error}<Alert message={form.error} />{/if}
				<input type="hidden" name="token" value={data.token} />
				<fieldset>
					<legend>How would you like it?</legend>
					<label class="choice"><input type="radio" name="method" value="post" required checked={form?.method === 'post'} /><span><b>By courier</b> {rupees(FEE_PAISE)} plus the courier charge, quoted before you pay</span></label>
					{#if data.sameCity}
						<label class="choice"><input type="radio" name="method" value="handover" checked={form?.method === 'handover'} /><span><b>Local handover in {b.city}</b> {rupees(FEE_PAISE)} only. You collect it in person</span></label>
					{/if}
				</fieldset>
				<fieldset>
					<legend>For courier delivery</legend>
					<label>
						Delivery address
						<small>Only the courier gets this, and it is wiped when the order ends.</small>
						<textarea name="address" maxlength="500" autocomplete="street-address" defaultValue={form?.address ?? ''}></textarea>
					</label>
					<label>Delivery pincode <input name="pincode" inputmode="numeric" autocomplete="postal-code" defaultValue={form?.pincode ?? ''} /></label>
				</fieldset>
				<p class="fine">{data.ordersLeft} of 3 orders left this month. You see the full price before you pay.</p>
				<button class="btn primary wide">Continue</button>
			</form>
		{/if}

		{#if data.signedIn && !b.mine}
			<details>
				<summary>Report a problem</summary>
				<form method="post" action="?/report">
					<fieldset>
						<legend>What are you reporting?</legend>
						<label class="choice"><input type="radio" name="target" value="listing" checked /><span>This listing</span></label>
						<label class="choice"><input type="radio" name="target" value="user" /><span>The giver</span></label>
					</fieldset>
					<label>What is wrong? <textarea name="reason" maxlength="500" required></textarea></label>
					<button class="btn">Send report</button>
				</form>
			</details>
		{/if}
	</div>
</div>
