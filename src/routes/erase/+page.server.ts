import { error, fail, redirect } from '@sveltejs/kit';
import { erasableUser } from '$lib/server/auth';
import { deleteAccount } from '$lib/server/engine';
import { attempt } from '$lib/server/form';

// Banned users cannot sign in, so Google sign-in hands them a short-lived token for this page alone.
export const load = ({ cookies }) => {
	if (!erasableUser(cookies.get('erase'))) error(404, 'Not found');
};

export const actions = {
	default: async ({ request, cookies }) => {
		const id = erasableUser(cookies.get('erase'));
		if (!id) error(404, 'Not found');
		if ((await request.formData()).get('confirm') !== 'on') return fail(400, { error: 'Tick the box to confirm.' });
		const failed = await attempt(() => deleteAccount(id));
		if (failed) return failed;
		cookies.delete('erase', { path: '/erase' });
		redirect(303, '/');
	}
};
