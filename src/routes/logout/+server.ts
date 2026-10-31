import { redirect } from '@sveltejs/kit';
import { endSession } from '$lib/server/auth';

export const POST = async ({ cookies }) => {
	await endSession(cookies);
	redirect(303, '/');
};
