<script lang="ts">
	import { BRAND } from '$lib/brand';
</script>

<svelte:head><title>Privacy · {BRAND.name}</title></svelte:head>

<div class="page prose">
	<h1>Privacy</h1>
	<p>
		This notice explains how {BRAND.name} handles your personal data under India’s Digital Personal Data
		Protection Act, 2023 (DPDP Act).
	</p>

	<h2>What we collect, and why</h2>
	<ul>
		<li>Name and email from Google sign-in: to identify your account and send order updates.</li>
		<li>City, pincode and WhatsApp number: to arrange orders and quote courier charges.</li>
		<li>Delivery and pickup addresses, for courier orders only: so the book can be collected and delivered.</li>
		<li>Your listings, orders, notes and thank-yous: to run the service.</li>
		<li>Payment references from Razorpay. We never receive your card or UPI details.</li>
	</ul>
	<p>You give consent by creating an account and entering these details. You can withdraw it by deleting your account.</p>

	<h2>Who sees it</h2>
	<ul>
		<li>Public pages show a book’s title, condition, and its history: how many readers it has had and the cities it has passed through. Never a name.</li>
		<li>Your WhatsApp number is visible only to the other person in an order, only once the giver accepts, and for no more than 7 days after the order ends.</li>
		<li>A giver’s first name and note reach the reader only once the giver accepts. Notes and thank-yous are visible only to those two people, and to admins if one is reported.</li>
		<li>Addresses and pincodes are wiped from our records when an order ends. Other readers never see them.</li>
	</ul>

	<h2>Service providers</h2>
	<p>We share only what each one needs to do its job, and we do not sell your data.</p>
	<ul>
		<li>Razorpay processes payments and refunds.</li>
		<li>Our courier partner, Shiprocket, receives the names, phone numbers and addresses needed to collect and deliver a book.</li>
		<li>Google handles sign-in, and our hosting and email providers run the service.</li>
	</ul>

	<h2>Your rights</h2>
	<p>
		Under the DPDP Act you can access and correct your data, have it erased, nominate someone to act for
		you, and raise a grievance with us and then with the Data Protection Board of India. Edit your
		details on your profile page, and delete your account there too.
	</p>

	<h2>Keeping and deleting data</h2>
	<p>
		Deleting your account removes your name, email, phone, city, pincode, listings, notes, thank-yous
		and the text of reports you made. If a courier has a book for one of your orders, you can delete once
		it has arrived. Banned users can erase their data the same way, by signing in with Google.
	</p>
	<p>
		We keep payment and order records without your name for as long as tax and accounting law requires,
		and the cities in a book’s history. We also keep a salted hash of your Google account id, used only
		so that a ban and the monthly order limit still apply if the account signs up again.
	</p>
</div>
