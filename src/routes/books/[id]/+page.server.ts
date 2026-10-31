import { error, fail, redirect } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { MONTHLY_CAP, createOrder, ordersThisMonth } from '$lib/server/engine';
import { attempt, signedIn } from '$lib/server/form';
import { allow } from '$lib/server/ratelimit';
import { UUID, multiline, pincode, text } from '$lib/server/validate';

export const load = async ({ params, locals }) => {
	if (!UUID.test(params.id)) error(404, 'Book not found');
	// Public and shareable. Select nothing that identifies a person: no names, ever.
	const [book] = await sql`
		SELECT l.id, l.title, l.author, l.isbn, l.condition, l.status, l.journey_id,
			COALESCE(u.city, 'India') AS city, l.giver_id = ${locals.user?.id ?? null} AS mine
		FROM listings l JOIN users u ON u.id = l.giver_id
		WHERE l.id = ${params.id} AND l.status <> 'removed'`;
	if (!book) error(404, 'Book not found');
	const { journey_id, ...rest } = book;
	const stops = await sql`SELECT city FROM journey_stops WHERE journey_id = ${journey_id} ORDER BY id`;
	const [current] = await sql`SELECT id FROM listings
		WHERE journey_id = ${journey_id} AND status IN ('available', 'reserved') AND id <> ${params.id}`;
	return {
		book: { ...rest },
		journey: { readers: stops.length, cities: stops.map((s) => s.city as string), currentId: (current?.id as string) ?? null },
		signedIn: !!locals.user,
		ordersLeft: locals.user ? Math.max(0, MONTHLY_CAP - (await ordersThisMonth(locals.user.id))) : null
	};
};

export const actions = {
	request: async ({ request, params, locals }) => {
		const user = signedIn(locals);
		if (!UUID.test(params.id)) error(404, 'Book not found');
		if (!user.city || !user.whatsapp) redirect(303, '/me');
		const form = await request.formData();
		const method = form.get('method');
		if (method !== 'handover' && method !== 'post') return fail(400, { error: 'Choose how you want the book.' });
		const address = multiline(form.get('address'), 500);
		const pin = pincode(form.get('pincode'));
		if (method === 'post' && (!address || address.length < 10 || !pin))
			return fail(400, { error: 'Enter your full delivery address and a 6-digit pincode.' });
		if (!allow(`request:${user.id}`, 10, 10)) return fail(429, { error: 'Too many requests. Try again later.' });
		let orderId = '';
		const failed = await attempt(async () => {
			orderId = (await createOrder(user.id, params.id, { method, address, pincode: pin })).id;
		});
		if (failed) return failed;
		redirect(303, `/orders/${orderId}`);
	},

	report: async ({ request, params, locals }) => {
		const user = signedIn(locals);
		if (!UUID.test(params.id)) error(404, 'Book not found');
		const form = await request.formData();
		const reason = text(form.get('reason'), 500);
		if (!reason) return fail(400, { error: 'Tell us what is wrong (up to 500 characters).' });
		const aboutUser = form.get('target') === 'user';
		const [l] = await sql`SELECT giver_id FROM listings WHERE id = ${params.id}`;
		if (!l) error(404, 'Book not found');
		await sql`INSERT INTO reports (reporter_id, listing_id, user_id, reason, subject)
			VALUES (${user.id}, ${params.id}, ${aboutUser ? l.giver_id : null}, ${reason}, ${aboutUser ? 'user' : 'listing'})`;
		return { reported: true };
	}
};
