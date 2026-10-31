import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { bannedAccount, startSession, upsertGoogleUser } from '$lib/server/auth';

export const GET = async ({ url, cookies }) => {
	const state = cookies.get('oauth_state');
	const verifier = cookies.get('oauth_verifier');
	cookies.delete('oauth_state', { path: '/auth' });
	cookies.delete('oauth_verifier', { path: '/auth' });
	const code = url.searchParams.get('code');
	if (!state || !verifier || !code || url.searchParams.get('state') !== state)
		error(400, 'Sign-in expired. Please try again.');

	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		body: new URLSearchParams({
			code,
			client_id: process.env.GOOGLE_CLIENT_ID ?? '',
			client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
			redirect_uri: `${url.origin}/auth/google/callback`,
			grant_type: 'authorization_code',
			code_verifier: verifier
		}),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) error(502, 'Google sign-in failed. Please try again.');

	// The token came straight from Google over TLS, so OIDC does not require a signature check.
	const { id_token } = await res.json();
	const claims = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString());
	if (claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now() || !claims.email_verified)
		error(400, 'Google did not confirm this account.');

	const userId = await upsertGoogleUser(claims.sub, claims.email, claims.name ?? claims.email.split('@')[0]);
	if (!userId) {
		const erase = await bannedAccount(claims.sub);
		if (!erase) error(403, 'This account has been banned.');
		cookies.set('erase', erase, { path: '/erase', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge: 900 });
		redirect(303, '/erase');
	}
	await startSession(cookies, userId);
	redirect(303, '/books');
};
