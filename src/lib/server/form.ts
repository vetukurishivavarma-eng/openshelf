import { fail, redirect } from '@sveltejs/kit';
import { OrderError } from './engine';

/**
 * Turns an OrderError into a form error that keeps what the user typed. A repeat of something
 * that already happened is not an error: it goes to `doneAt`, the page showing the result.
 */
export async function attempt<V extends object = object>(fn: () => Promise<unknown>, values?: V, doneAt?: string) {
	try {
		await fn();
		return null;
	} catch (e) {
		if (!(e instanceof OrderError)) throw e;
		if (e.stale && doneAt) redirect(303, doneAt);
		return fail(400, { error: e.message, ...(values as V) });
	}
}

export function signedIn(locals: App.Locals) {
	if (!locals.user) redirect(303, '/auth/google');
	return locals.user;
}
