<script lang="ts">
	import { BRAND } from '$lib/brand';
	import { onMount } from 'svelte';
	import Alert from '$lib/ui/Alert.svelte';
	import { once } from '$lib/ui/once';
	let { data, form } = $props();

	let isbnInput = $state<HTMLInputElement>();
	let video = $state<HTMLVideoElement>();
	let canScan = $state(false);
	let scanning = $state(false);
	let stop = $state(() => {});

	onMount(() => {
		canScan = 'BarcodeDetector' in window;
		return () => stop();
	});

	async function scan() {
		// @ts-expect-error BarcodeDetector is not in TypeScript's DOM types yet.
		const detector = new BarcodeDetector({ formats: ['ean_13'] });
		const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
		let timer = 0;
		stop = () => {
			clearInterval(timer);
			stream.getTracks().forEach((t) => t.stop());
			scanning = false;
		};
		scanning = true;
		video!.srcObject = stream;
		await video!.play();
		timer = window.setInterval(async () => {
			const [code] = await detector.detect(video);
			if (code && isbnInput) {
				isbnInput.value = code.rawValue;
				stop();
			}
		}, 300);
	}
</script>

<svelte:head><title>Give a book · {BRAND.name}</title></svelte:head>

<div class="page narrow">
	<h1>Give a book</h1>

	<form method="post" action="?/create" use:once>
		{#if form?.error}<Alert message={form.error} />{/if}
		<input type="hidden" name="token" value={data.token} />
		<div class="sheet">
			<label>
				ISBN
				<small>The 10 or 13 digit number by the barcode. Skip this if your book has none.</small>
				<input name="isbn" inputmode="numeric" autocomplete="off" bind:this={isbnInput} defaultValue={form?.isbn ?? ''} />
			</label>
			<div class="actions">
				<button class="btn" formaction="?/lookup" formnovalidate>Look up details</button>
				{#if canScan}
					<button class="btn" type="button" onclick={scanning ? stop : scan}>{scanning ? 'Stop scanning' : 'Scan barcode'}</button>
				{/if}
			</div>
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={video} hidden={!scanning} playsinline muted width="280"></video>
		</div>

		<label>Title <input name="title" required maxlength="200" defaultValue={form?.title ?? ''} /></label>
		<label>Author <input name="author" required maxlength="200" defaultValue={form?.author ?? ''} /></label>
		<fieldset>
			<legend>Condition</legend>
			<label class="choice"><input type="radio" name="condition" value="like_new" required checked={form?.condition === 'like_new'} /><span>Like new</span></label>
			<label class="choice"><input type="radio" name="condition" value="good" checked={form?.condition === 'good'} /><span>Good</span></label>
			<label class="choice"><input type="radio" name="condition" value="worn" checked={form?.condition === 'worn'} /><span>Well read</span></label>
		</fieldset>
		<label>
			A note to the next reader
			<small>Optional, up to 280 characters. The next reader sees it once you accept their order.</small>
			<textarea name="note" maxlength="280" defaultValue={form?.note ?? ''}></textarea>
		</label>
		<p class="fine">Giving is free. Original copies only. Pirated copies and photocopies are banned.</p>
		<button class="btn primary wide">Give this book</button>
	</form>
</div>
