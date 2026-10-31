import { testMode } from '$lib/server/engine';

export const load = ({ locals }) => ({
	user: locals.user && { isAdmin: locals.user.isAdmin },
	testMode: testMode()
});
