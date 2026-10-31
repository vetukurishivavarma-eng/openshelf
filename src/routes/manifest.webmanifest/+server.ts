import { BRAND } from '$lib/brand';

const icon = (src: string, sizes: string, type: string, purpose: string) => ({ src, sizes, type, purpose });

// A route, not a static file, so the installed app's name comes from BRAND.
export const GET = () =>
	new Response(
		JSON.stringify({
			id: '/',
			name: BRAND.name,
			short_name: BRAND.name,
			description: BRAND.tagline,
			start_url: '/books',
			display: 'standalone',
			background_color: '#f3eadb',
			theme_color: '#a2291a',
			icons: [
				icon('/icon.svg', 'any', 'image/svg+xml', 'any'),
				icon('/icon-192.png', '192x192', 'image/png', 'any'),
				icon('/icon-512.png', '512x512', 'image/png', 'any'),
				icon('/icon-maskable-192.png', '192x192', 'image/png', 'maskable'),
				icon('/icon-maskable-512.png', '512x512', 'image/png', 'maskable')
			]
		}),
		{ headers: { 'Content-Type': 'application/manifest+json' } }
	);
