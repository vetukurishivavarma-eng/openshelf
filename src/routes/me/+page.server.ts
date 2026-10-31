import { fail, redirect } from '@sveltejs/kit';
import { endAllSessions, endSession } from '$lib/server/auth';
import { sql } from '$lib/server/db';
import { deleteAccount } from '$lib/server/engine';
import { attempt, signedIn } from '$lib/server/form';
import { allow } from '$lib/server/ratelimit';
import { city as normalCity, pincode, text, whatsapp } from '$lib/server/validate';

export const load = ({ locals }) => {
	const { name, city, pincode, whatsapp, email } = signedIn(locals);
	return { profile: { name, city, pincode, whatsapp: whatsapp?.slice(3) ?? null, email } };
};

export const actions = {
	save: async ({ request, locals }) => {
		const user = signedIn(locals);
		const form = await request.formData();
		const field = (k: string) => {
			const v = form.get(k);
			return typeof v === 'string' ? v : '';
		};
		const values = { name: field('name'), city: field('city'), pincode: field('pincode'), whatsapp: field('whatsapp') };
		const name = text(values.name, 100);
		const city = normalCity(values.city);
		const pin = pincode(values.pincode);
		const phone = whatsapp(values.whatsapp);
		if (!name) return fail(400, { ...values, error: 'Enter your name.' });
		if (!city) return fail(400, { ...values, error: 'Enter your city, in letters only.' });
		if (!pin) return fail(400, { ...values, error: 'Enter a 6-digit pincode.' });
		if (!phone) return fail(400, { ...values, error: 'Enter a 10-digit Indian mobile number.' });
		if (!allow(`profile:${user.id}`, 10, 10)) return fail(429, { ...values, error: 'Too many changes. Try again later.' });
		try {
			await sql`UPDATE users SET name = ${name}, city = ${city}, pincode = ${pin}, whatsapp = ${phone}
				WHERE id = ${user.id}`;
		} catch (e) {
			if ((e as { code?: string }).code === '23505')
				return fail(400, { ...values, error: 'That WhatsApp number is already on another account.' });
			throw e;
		}
		return { saved: true };
	},

	everywhere: async ({ locals, cookies }) => {
		await endAllSessions(cookies, signedIn(locals).id);
		redirect(303, '/');
	},

	delete: async ({ request, locals, cookies }) => {
		const user = signedIn(locals);
		if ((await request.formData()).get('confirm') !== 'on')
			return fail(400, { error: 'Tick the box to confirm.' });
		const failed = await attempt(() => deleteAccount(user.id));
		if (failed) return failed;
		await endSession(cookies);
		redirect(303, '/');
	}
};
