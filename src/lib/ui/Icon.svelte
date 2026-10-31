<script lang="ts">
	// Hand-picked 24px stroke icons. Decorative: the text beside each one carries the meaning.
	const PATHS: Record<string, string> = {
		search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5',
		plus: 'M12 5v14M5 12h14',
		shelf: 'M4 4v15M8 4v15M13 5l4 14M2 20h20',
		orders: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
		user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c1-4 4-6 8-6s7 2 8 6',
		admin: 'M12 3l8 3v6c0 5-3 8-8 9-5-1-8-4-8-9V6l8-3Z',
		ticket: 'M3 7h18v3.5a1.5 1.5 0 0 0 0 3V17H3v-3.5a1.5 1.5 0 0 0 0-3V7ZM14 7v2M14 11v2M14 15v2',
		check: 'M4 12.5l5 5L20 6.5',
		alert: 'M12 4 2.5 20h19L12 4ZM12 10v5M12 17.5v.5',
		clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',
		chat: 'M4 5h16v11H9l-5 4V5Z',
		arrow: 'M4 12h15M13 6l6 6-6 6',
		book: 'M12 6c-2-1.5-5-2-8-2v15c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2ZM12 6v15',
		out: 'M10 4H4v16h6M9 12h11M16 8l4 4-4 4'
	};
	let { name }: { name: string } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={PATHS[name]} /></svg>
