import { dev } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { pkceChallenge, randomToken } from '$lib/server/auth';
import { allow } from '$lib/server/ratelimit';

export const GET = (event) => {
	// getClientAddress throws if ADDRESS_HEADER is set but absent; a shared bucket beats a 500.
	let ip = 'unknown';
	try {
		ip = event.getClientAddress();
	} catch {}
	if (!allow(`signin:${ip}`, 20, 20)) error(429, 'Too many sign-in attempts. Try again later.');

	const clientId = process.env.GOOGLE_CLIENT_ID;
	if (!clientId) error(503, 'Google sign-in is not configured.');

	const state = randomToken();
	const verifier = randomToken();
	const opts = { path: '/auth', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge: 600 } as const;
	event.cookies.set('oauth_state', state, opts);
	event.cookies.set('oauth_verifier', verifier, opts);

	const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: `${event.url.origin}/auth/google/callback`,
		response_type: 'code',
		scope: 'openid email profile',
		state,
		code_challenge: pkceChallenge(verifier),
		code_challenge_method: 'S256'
	}).toString();
	redirect(303, url.toString());
};
