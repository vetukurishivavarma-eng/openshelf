import { fail, redirect } from '@sveltejs/kit';
import { endSession } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { deleteAccount } from '$lib/server/engine';
import { signedIn } from '$lib/server/form';
import { pincode, text, whatsapp } from '$lib/server/validate';

export const load = ({ locals }) => {
	const { name, city, pincode, whatsapp, email } = signedIn(locals);
	return { profile: { name, city, pincode, whatsapp: whatsapp?.slice(3) ?? null, email } };
};

export const actions = {
	save: async ({ request, locals }) => {
		const user = signedIn(locals);
		const form = await request.formData();
		const name = text(form.get('name'), 100);
		const city = text(form.get('city'), 60);
		const pin = pincode(form.get('pincode'));
		const phone = whatsapp(form.get('whatsapp'));
		if (!name) return fail(400, { error: 'Enter your name.' });
		if (!city) return fail(400, { error: 'Enter your city.' });
		if (!pin) return fail(400, { error: 'Enter a 6-digit pincode.' });
		if (!phone) return fail(400, { error: 'Enter a 10-digit Indian mobile number.' });
		try {
			await sql`UPDATE users SET name = ${name}, city = ${city}, pincode = ${pin}, whatsapp = ${phone}
				WHERE id = ${user.id}`;
		} catch (e) {
			if ((e as { code?: string }).code === '23505')
				return fail(400, { error: 'That WhatsApp number is already on another account.' });
			throw e;
		}
		return { saved: true };
	},

	delete: async ({ request, locals, cookies }) => {
		const user = signedIn(locals);
		if ((await request.formData()).get('confirm') !== 'on')
			return fail(400, { error: 'Tick the box to confirm.' });
		await deleteAccount(user.id);
		await endSession(cookies);
		redirect(303, '/');
	}
};
