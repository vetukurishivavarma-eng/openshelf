import { createHash, timingSafeEqual } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { startSession, upsertGoogleUser } from '$lib/server/auth';
import { allow } from '$lib/server/ratelimit';

// ponytail: password sign-in for the test deployment only, while there is no Google OAuth client.
// Anyone with the password can sign in as any email, admins included. Unset TEST_LOGIN_PASSWORD
// and delete this route before launch.
const password = () => process.env.TEST_LOGIN_PASSWORD ?? '';
const digest = (s: string) => createHash('sha256').update(s).digest();

export const load = () => {
	if (!password()) error(404, 'Not found');
};

export const actions = {
	default: async (event) => {
		if (!password()) error(404, 'Not found');
		let ip = 'unknown';
		try {
			ip = event.getClientAddress();
		} catch {}
		if (!allow(`testlogin:${ip}`, 10, 10)) return fail(429, { error: 'Too many attempts. Try again later.', email: '' });

		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return fail(400, { error: 'Enter a valid email.', email });
		if (!timingSafeEqual(digest(String(form.get('password') ?? '')), digest(password())))
			return fail(403, { error: 'Wrong password.', email });

		const userId = await upsertGoogleUser(`test:${email}`, email, email.split('@')[0]);
		if (!userId) return fail(403, { error: 'This account is banned.', email });
		await startSession(event.cookies, userId);
		redirect(303, '/books');
	}
};
