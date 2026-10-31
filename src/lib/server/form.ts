import { fail, redirect } from '@sveltejs/kit';
import { OrderError } from './engine';

/** Turns a OrderError into a form error; anything else stays a real failure. */
export async function attempt(fn: () => Promise<unknown>) {
	try {
		await fn();
		return null;
	} catch (e) {
		if (e instanceof OrderError) return fail(400, { error: e.message });
		throw e;
	}
}

export function signedIn(locals: App.Locals) {
	if (!locals.user) redirect(303, '/auth/google');
	return locals.user;
}
