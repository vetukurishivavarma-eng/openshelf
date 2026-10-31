<script lang="ts">
	// A postmark: where this copy sets out from. The brand's signature object.
	let { city }: { city: string } = $props();
	const id = $props.id();
</script>

<svg class="stamp" class:long={city.length > 11} viewBox="0 0 100 100" role="img" aria-label="Given from {city}">
	<defs><path id="{id}-t" d="M15 50a35 35 0 0 1 70 0" /><path id="{id}-b" d="M9 50a41 41 0 0 0 82 0" /></defs>
	<circle class="disc" cx="50" cy="50" r="47" />
	<path class="ring" d="M22 42h56M22 58h56" />
	<text class="arc city"><textPath href="#{id}-t" startOffset="50%">{city.toUpperCase()}</textPath></text>
	<text class="arc"><textPath href="#{id}-b" startOffset="50%">NEXT READER</textPath></text>
	<text class="n" x="50" y="54.5">GIVEN</text>
</svg>
