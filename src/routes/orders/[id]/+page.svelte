<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { invalidateAll } from '$app/navigation';
	import { CONDITION_LABEL, ORDER_STATUS, REFUND_STATUS, fmtDate, fmtDeadline, rupees } from '$lib/labels';
	import Alert from '$lib/ui/Alert.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import { once } from '$lib/ui/once';
	let { data, form } = $props();
	const o = $derived(data.order);
	const giver = $derived(o.role === 'giver');
	const courier = $derived(o.method === 'post');
	const nameOf = (name: string | null, fallback: string) =>
		!name ? fallback : name === 'Former' ? 'a former reader' : name;
	const other = $derived(giver ? nameOf(o.reader_name, 'the reader') : nameOf(o.giver_name, 'the giver'));
	const Other = $derived(other[0].toUpperCase() + other.slice(1));

	// Mirrors DEADLINE_HOURS in src/lib/server/engine.ts.
	const WINDOW_HOURS: Record<string, number> = { requested: 0.5, paid: 72, pickup_booked: 5 * 24, delivered: 14 * 24 };
	const by = $derived(
		WINDOW_HOURS[o.status]
			? fmtDeadline(new Date(new Date(o.status_at).getTime() + WINDOW_HOURS[o.status] * 3_600_000))
			: ''
	);

	/** What this viewer should do now: a headline, and what happens otherwise. */
	const next = $derived.by((): { act: boolean; title: string; body: string } => {
		switch (o.status) {
			case 'requested':
				return { act: true, title: `Pay by ${by} to reserve this book`, body: 'The book is held for you until then. Payment makes the reservation final.' };
			case 'paid':
				return giver
					? { act: true, title: `Accept or decline by ${by}`, body: `${Other} has paid for this book. If you do nothing, the order expires and they are refunded in full.` }
					: { act: false, title: `The giver has until ${by} to answer`, body: 'If they decline or do not reply, you get a full refund. Their note reaches you when they accept.' };
			case 'pickup_booked':
				if (courier)
					return giver
						? { act: false, title: 'The courier will collect from you', body: `Keep the book ready. If it is not collected by ${by}, we check with the courier, then refund or ask an admin to look.` }
						: { act: false, title: 'The pickup is booked', body: `If the courier cannot collect by ${by}, we check with them and refund you, or an admin reviews the order.` };
				return giver
					? { act: true, title: `Hand the book over by ${by}`, body: `Agree a place with ${other} on WhatsApp and meet somewhere public. If it does not happen by then, an admin reviews the order. You can also cancel, which refunds them in full.` }
					: { act: true, title: `Agree a handover with ${other}`, body: `Message on WhatsApp and pick a public place. If something goes wrong, raise a dispute. If it does not happen by ${by}, an admin reviews the order.` };
			case 'in_transit':
				return { act: false, title: 'The book is on its way', body: 'The courier has it. If the courier reports a failure, or nothing moves for 21 days, an admin reviews the order.' };
			case 'delivered':
				return giver
					? { act: false, title: `${Other} confirms by ${by}`, body: 'If they stay silent, the order confirms itself at that time.' }
					: { act: true, title: `Confirm or raise a problem by ${by}`, body: 'Press the button once the book is with you. If you do neither, the order confirms itself.' };
			case 'disputed':
				return { act: false, title: 'An admin is reviewing this order', body: 'There is nothing for you to do. If the dispute is upheld, the reader is refunded in full.' };
			case 'received':
				if (giver) return { act: false, title: 'Your book reached its next reader', body: 'Thank you for passing it on.' };
				if (o.onward_id) return { act: false, title: 'The book is yours', body: o.thank_you ? 'You thanked the giver and gave it onward. Its journey carries on.' : 'You gave it onward. Its journey carries on.' };
				return { act: true, title: 'The book is yours', body: o.thank_you ? 'Your thank-you is sent. When you finish the book, give it onward.' : 'Send a thank-you, and when you finish it, give it onward. Its journey carries on.' };
			case 'declined':
				return { act: false, title: giver ? 'You declined this order' : 'The giver declined this order', body: giver ? 'The book is back on the shelf.' : 'Your payment is being refunded in full.' };
			case 'cancelled':
				return { act: false, title: 'This order was cancelled', body: 'Any payment is refunded in full.' };
			case 'expired':
				return { act: false, title: 'This order ran out of time', body: 'Any payment is refunded in full.' };
			default:
				return { act: false, title: 'This order was refunded', body: 'The full amount is on its way back to the reader.' };
		}
	});

	// The slip: only steps this order really reached, then the ones it can still reach.
	const path = $derived.by(() => {
		if (['declined', 'cancelled', 'expired'].includes(o.status))
			return o.status === 'cancelled' || !o.paid ? ['requested', o.status] : ['requested', 'paid', o.status];
		const route = courier ? ['requested', 'paid', 'pickup_booked', 'in_transit', 'delivered'] : ['requested', 'paid', 'pickup_booked', 'delivered'];
		const upTo = (step: string) => route.slice(0, route.indexOf(step) + 1);
		if (o.disputed_from) return [...upTo(o.disputed_from), 'disputed', o.status === 'refunded' ? 'refunded' : 'received'];
		if (o.status === 'refunded') return [...upTo('pickup_booked'), 'refunded'];
		return [...route, 'received'];
	});
	const at = $derived(path.indexOf(o.status));
	const stepName = (step: string) => (step === 'pickup_booked' ? (courier ? 'Pickup booked' : 'Handover agreed') : ORDER_STATUS[step]);
	const canDispute = $derived(
		!giver && (o.status === 'delivered' || o.status === 'in_transit' || (o.status === 'pickup_booked' && !courier))
	);
	const canCancel = $derived(
		giver ? o.status === 'pickup_booked' && !courier : o.status === 'requested' || o.status === 'paid'
	);

	let waiting = $state(false);
	function pay() {
		const script = document.createElement('script');
		script.src = 'https://checkout.razorpay.com/v1/checkout.js';
		script.onload = () => {
			// @ts-expect-error Razorpay is a global from the script above.
			new Razorpay({
				key: data.razorpayKey,
				order_id: o.gateway_order_id,
				name: BRAND.name,
				description: o.title,
				// Only the signed webhook confirms payment, so this just waits for it.
				handler: () => {
					waiting = true;
					let tries = 0;
					const timer = setInterval(() => {
						invalidateAll();
						if (++tries > 20 || o.status !== 'requested') clearInterval(timer);
					}, 3000);
				}
			}).open();
		};
		document.head.append(script);
	}
</script>

<svelte:head><title>{o.title} · {BRAND.name}</title></svelte:head>

<div class="page">
	<p class="typed crumb"><a href="/orders">Orders</a> / {ORDER_STATUS[o.status]}</p>
	<h1>{o.title}</h1>
	<p class="by large">{o.author}</p>

	<div class="order">
		<div>
			{#if form?.error}<Alert message={form.error} />{/if}
			{#if data.reported}<p class="note" role="status"><Icon name="check" />Thanks. An admin will look at your report.</p>{/if}

			<section class="next" class:act={next.act} aria-labelledby="next">
				<p class="typed">{next.act ? 'Your move' : 'Where it stands'}</p>
				<h2 id="next">{next.title}</h2>
				<p>{next.body}</p>

				{#if o.refund_status}<p class="typed">{REFUND_STATUS[o.refund_status]}</p>{/if}

				{#if o.whatsapp}
					<a class="btn" href="https://wa.me/{o.whatsapp.slice(1)}" rel="noreferrer"><Icon name="chat" />WhatsApp {other}</a>
				{/if}

				{#if o.address}
					<h3>Delivery address</h3>
					<p class="address">{o.address}</p>
				{/if}
				{#if o.pickup_address}
					<h3>Pickup address</h3>
					<p class="address">{o.pickup_address}</p>
				{/if}

				{#if o.status === 'requested' && !giver}
					{#if data.testControls}
						<form method="post" action="?/testpay" use:once><button class="btn primary wide">Pay {rupees(o.total_paise ?? 0)} (test, no money moves)</button></form>
					{:else if waiting}
						<p class="note" role="status"><Icon name="clock" />Confirming your payment…</p>
					{:else}
						<button class="btn primary wide" onclick={pay}>Pay {rupees(o.total_paise ?? 0)}</button>
					{/if}
				{/if}

				{#if o.status === 'paid' && giver}
					<form method="post" action="?/accept" use:once>
						{#if courier}
							<label>
								Pickup address
								<small>Where the courier collects the book, in the pincode on your profile. Only the courier gets this, and it is wiped when the order ends.</small>
								<textarea name="pickup_address" required minlength="10" maxlength="500" defaultValue={form?.pickup_address ?? ''}></textarea>
							</label>
						{/if}
						<button class="btn primary">Accept</button>
					</form>
					<form method="post" action="?/decline" use:once><button class="btn">Decline</button></form>
				{/if}

				{#if o.status === 'pickup_booked' && giver && !courier}
					<form method="post" action="?/handover" use:once><button class="btn primary">I have handed it over</button></form>
				{/if}

				{#if o.status === 'delivered' && !giver}
					<form method="post" action="?/received" use:once><button class="btn primary">I have the book</button></form>
				{/if}

				{#if canDispute}
					<details open={!!form?.dispute_note}>
						<summary>Something wrong?</summary>
						<form method="post" action="?/dispute" use:once>
							<label>What went wrong? <textarea name="note" required maxlength="500" defaultValue={form?.dispute_note ?? ''}></textarea></label>
							<button class="btn">Raise a dispute</button>
						</form>
					</details>
				{/if}
			</section>

			{#if o.note}
				<section aria-labelledby="note">
					<h2 id="note">{giver ? 'Your note to the next reader' : 'A note from the giver'}</h2>
					<p class="letter">{o.note}</p>
				</section>
			{/if}

			{#if o.thank_you}
				<section aria-labelledby="thanks">
					<h2 id="thanks">{giver ? 'A thank-you for you' : 'Your thank-you'}</h2>
					<p class="letter">{o.thank_you}</p>
				</section>
			{:else if o.status === 'received' && !giver}
				<form method="post" action="?/thanks" use:once>
					<label>
						Say thank you
						<small>Up to 280 characters. Only the giver reads it.</small>
						<textarea name="message" required maxlength="280" defaultValue={form?.message ?? ''}></textarea>
					</label>
					<button class="btn">Send thank-you</button>
				</form>
			{/if}

			{#if o.status === 'received' && !giver}
				{#if o.onward_id}
					<p class="note"><a href="/books/{o.onward_id}">You gave this book onward. See its journey.</a></p>
				{:else}
					<form method="post" action="?/onward" use:once>
						<h2>Give it onward</h2>
						<p>Finished? Relist this copy and its journey carries on.</p>
						<fieldset>
							<legend>Condition now</legend>
							{#each Object.entries(CONDITION_LABEL) as [value, label]}
								<label class="choice"><input type="radio" name="condition" {value} required /><span>{label}</span></label>
							{/each}
						</fieldset>
						<label>
							A note to the next reader
							<small>Optional, up to 280 characters. The next reader sees it once you accept their order.</small>
							<textarea name="note" maxlength="280" defaultValue={form?.onward_note ?? ''}></textarea>
						</label>
						<button class="btn">Give it onward</button>
					</form>
				{/if}
			{/if}

			{#if (giver && o.thank_you) || (!giver && o.note)}
				<details>
					<summary>Report this message</summary>
					<form method="post" action="?/report">
						<label>What is wrong? <textarea name="reason" maxlength="500" required defaultValue={form?.report_reason ?? ''}></textarea></label>
						<button class="btn">Send report</button>
					</form>
				</details>
			{/if}

			{#if data.testControls && courier && (o.status === 'pickup_booked' || o.status === 'in_transit')}
				<form class="sheet" method="post" action="?/testcourier" use:once>
					<p class="typed">Test mode, no money moves. Pretend to be the courier:</p>
					<div class="actions">
						{#if o.status === 'pickup_booked'}<button class="btn" name="kind" value="picked_up">Picked up</button>{/if}
						{#if o.status === 'in_transit'}<button class="btn" name="kind" value="delivered">Delivered</button>{/if}
						<button class="btn" name="kind" value="failed">Failed</button>
					</div>
				</form>
			{/if}

			{#if canCancel}
				<form method="post" action="?/cancel" use:once><button class="btn quiet">Cancel order</button></form>
			{/if}
		</div>

		<aside aria-label="Order progress">
			<div class="slip due">
				<p class="slip-title">{courier ? 'By courier' : 'Handover'} · with {other}</p>
				{#if !giver}
					<p class="total">
						{#if courier}{rupees(o.fee_paise ?? 0)} fee + {rupees(o.courier_paise ?? 0)} courier = {rupees(o.total_paise ?? 0)}{:else}{rupees(o.total_paise ?? 0)} fee{/if}
					</p>
				{/if}
				<ol>
					{#each path as step, i}
						<li class:done={i < at || o.status === 'received'} class:now={i === at} aria-current={i === at ? 'step' : undefined}>
							<span class="tick">{#if i < at || o.status === 'received'}<Icon name="check" />{/if}</span>
							<span>{stepName(step)}</span>
							{#if i === at}<time class="date">{fmtDate(o.status_at)}</time>{/if}
						</li>
					{/each}
				</ol>
			</div>
		</aside>
	</div>
</div>
