import { dev } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { startSession, upsertGoogleUser } from '$lib/server/auth';

// `dev` compiles to false in a build, so this branch is dropped from production output.
export const GET = async ({ url, cookies }) => {
	if (dev && process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === '1') {
		const email = url.searchParams.get('email') ?? 'asha@dev.local';
		const userId = await upsertGoogleUser(`dev:${email}`, email, email.split('@')[0]);
		if (!userId) error(403, 'Banned');
		await startSession(cookies, userId);
		redirect(303, '/books');
	}
	error(404, 'Not found');
};
