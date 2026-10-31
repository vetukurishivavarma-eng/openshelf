<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { FEE_PAISE, rupees } from '$lib/labels';
	const fee = rupees(FEE_PAISE);
</script>

<svelte:head><title>Terms · {BRAND.name}</title></svelte:head>

<div class="page prose">
	<h1>Terms of use</h1>

	<h2>What {BRAND.name} is</h2>
	<p>
		{BRAND.name} helps readers in India give away books they have finished. Books are free. We do not buy,
		sell or store books. Givers pay nothing.
	</p>

	<h2>Books you may list</h2>
	<p>
		List only original copies that you own. <strong>Pirated copies and photocopies are banned</strong>,
		including printed PDFs and spiral-bound copies. Listings that break this rule are removed and the
		account may be banned.
	</p>

	<h2>What a reader pays</h2>
	<ul>
		<li>A platform fee of {fee} on every order. It pays for running {BRAND.name}, not for the book.</li>
		<li>The courier charge for that order, quoted before you pay. A local handover has no courier charge.</li>
		<li>Payments are handled by Razorpay. We never see your card or UPI details.</li>
		<li>You can place up to 3 orders per calendar month. Refunded and cancelled orders do not count, except an accepted handover, which always counts.</li>
	</ul>

	<h2>Refunds</h2>
	<p>You get the full amount back, fee and courier charge, if:</p>
	<ul>
		<li>the giver does not respond within 72 hours, or declines;</li>
		<li>the pickup fails and the courier confirms it has stopped;</li>
		<li>you cancel before the giver accepts, or the giver cancels an agreed handover;</li>
		<li>a dispute is upheld.</li>
	</ul>
	<p>Refunds go back to the original payment method. Your bank may take a few days to show them.</p>

	<h2>Orders and courier</h2>
	<ul>
		<li>Unpaid orders hold a book for 30 minutes. Payment makes the reservation final.</li>
		<li>A courier partner collects from the giver and delivers to the reader. Please keep the book ready and packed.</li>
		<li>Local handover is for readers in the same city as the giver. Meet somewhere public. Once it is agreed, a problem goes through a dispute; a reader cannot cancel it. If it does not happen within 5 days, an admin reviews the order.</li>
		<li>If a courier may still have the book, or a cancellation fails, an admin decides before any refund.</li>
		<li>An order confirms itself 14 days after delivery unless the reader raises a dispute.</li>
		<li>An admin decides disputes. The decision is final on the platform.</li>
	</ul>

	<h2>Notes and thank-yous</h2>
	<p>
		Keep them kind and free of contact details. They are private to the two readers, and either can
		report one. We may remove a message that breaks these terms.
	</p>

	<h2>Conduct</h2>
	<p>
		Be honest about a book’s condition and use contact details only to complete an order. Reselling books
		from {BRAND.name} is not allowed. We may ban accounts that abuse the service. Banning hides listings
		and refunds orders the giver has not accepted. Accepted orders go to an admin.
	</p>
</div>
