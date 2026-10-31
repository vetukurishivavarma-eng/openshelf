import adapter from '@sveltejs/adapter-node';

const covers = ['https://covers.openlibrary.org', 'https://archive.org', 'https://*.archive.org'];

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		adapter: adapter(),
		// Kit's origin check on form posts is the CSRF defence (spec). It stays on.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['none'],
				'script-src': ['self', 'https://checkout.razorpay.com'],
				'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
				'style-src': ['self'],
				// Kit's route announcer, by hash, so no inline style is allowed in general.
				'style-src-attr': ['unsafe-hashes', 'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='],
				'font-src': ['self'],
				'img-src': ['self', ...covers],
				'connect-src': ['self', 'https://api.razorpay.com'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};
