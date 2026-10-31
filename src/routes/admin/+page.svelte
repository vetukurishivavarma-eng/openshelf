<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { fmtDate, rupees } from '$lib/labels';
	import Empty from '$lib/ui/Empty.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	let { data, form } = $props();
</script>

<svelte:head><title>Admin · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>Admin</h1>
	{#if form?.error}<p class="alert" role="alert"><Icon name="alert" />{form.error}</p>{/if}

	<h2 class="section">Disputes</h2>
	{#if data.disputes.length === 0}
		<Empty icon="check" title="No disputes open"><p>Nothing needs a decision.</p></Empty>
	{/if}
	<ul class="cases">
		{#each data.disputes as d (d.id)}
			<li>
				<h3>{d.title}</h3>
				<p class="typed">{d.owner_name} to {d.requester_name} · {d.method} · {rupees(d.total_paise)} paid</p>
				<p>{d.dispute_note}</p>
				<form class="actions" method="post" action="?/resolve">
					<input type="hidden" name="id" value={d.id} />
					<button class="btn" name="outcome" value="received">Reject: order stands</button>
					<button class="btn" name="outcome" value="refunded">Uphold: refund in full</button>
				</form>
			</li>
		{/each}
	</ul>

	<h2 class="section">Refunds outstanding</h2>
	{#if data.refunds.length === 0}
		<Empty icon="check" title="No refunds waiting"><p>Every refund has gone out.</p></Empty>
	{/if}
	<ul class="cases">
		{#each data.refunds as f (f.id)}
			<li>
				<h3>{rupees(f.amount_paise)}, {f.reason}</h3>
				<p class="typed">{f.status} · {f.attempts} attempts · since {fmtDate(f.created_at)}</p>
			</li>
		{/each}
	</ul>

	<h2 class="section">Reports</h2>
	{#if data.reports.length === 0}
		<Empty icon="check" title="No reports open"><p>Nothing has been flagged.</p></Empty>
	{/if}
	<ul class="cases">
		{#each data.reports as r (r.id)}
			<li>
				<h3>{r.title ?? 'Reader report'}</h3>
				<p class="typed">Against {r.target_name}{r.banned ? ' (banned)' : ''}</p>
				{#if r.message}<p class="letter">{r.message}</p>{/if}
				<p>{r.reason}</p>
				<div class="actions">
					<form method="post" action="?/close">
						<input type="hidden" name="id" value={r.id} />
						<button class="btn">Dismiss</button>
					</form>
					{#if r.message}
						<form method="post" action="?/cleartext">
							<input type="hidden" name="id" value={r.id} />
							<button class="btn">Remove text</button>
						</form>
					{/if}
					{#if r.subject === 'listing'}
						<form method="post" action="?/takedown">
							<input type="hidden" name="id" value={r.id} />
							<input type="hidden" name="listing" value={r.listing_id} />
							<button class="btn">Remove listing</button>
						</form>
					{/if}
					{#if !r.banned}
						<form method="post" action="?/ban">
							<input type="hidden" name="id" value={r.id} />
							<input type="hidden" name="user" value={r.target_id} />
							<button class="btn">Ban {r.target_name}</button>
						</form>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
</div>
