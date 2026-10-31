import { building, dev } from '$app/environment';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { sessionUser } from '$lib/server/auth';
import { sweep } from '$lib/server/engine';
import { assertConfig } from '$lib/server/payments';

const run = () => sweep().catch((e) => console.error('[sweep]', e));

export const init: ServerInit = async () => {
	if (building) return;
	assertConfig(!dev);
	void run();
	setInterval(run, 60 * 60 * 1000).unref();
};

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = await sessionUser(event.cookies);
	const response = await resolve(event);
	const h = response.headers;
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
	h.set('Cross-Origin-Opener-Policy', 'same-origin');
	if (!dev) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	// Signed-in pages carry private data; no shared cache may keep them.
	if (event.locals.user) h.set('Cache-Control', 'private, no-store');
	return response;
};
