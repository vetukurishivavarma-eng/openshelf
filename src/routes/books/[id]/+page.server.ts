import { randomUUID } from 'node:crypto';
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
			COALESCE(u.city, 'India') AS city, l.giver_id = ${locals.user?.id ?? null} AS mine,
			u.banned_at IS NOT NULL AS closed
		FROM listings l JOIN users u ON u.id = l.giver_id
		WHERE l.id = ${params.id} AND l.status <> 'removed'`;
	if (!book) error(404, 'Book not found');
	const [myOrder] = locals.user
		? await sql`SELECT id FROM orders WHERE listing_id = ${params.id} AND reader_id = ${locals.user.id}
			AND status IN ('requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed')`
		: [];
	// A banned giver's book stays reachable only to the two people in its order.
	if (book.closed && book.status === 'reserved' && !book.mine && !myOrder) error(404, 'Book not found');

	const { journey_id, closed: _, ...rest } = book;
	const stops = await sql`SELECT city FROM journey_stops WHERE journey_id = ${journey_id} ORDER BY id`;
	const [current] = await sql`SELECT id FROM listings
		WHERE journey_id = ${journey_id} AND status IN ('available', 'reserved') AND id <> ${params.id}`;
	return {
		book: { ...rest },
		journey: { readers: stops.length, cities: stops.map((s) => s.city as string), currentId: (current?.id as string) ?? null },
		signedIn: !!locals.user,
		myOrderId: (myOrder?.id as string) ?? null,
		sameCity: !!locals.user?.city && locals.user.city === book.city,
		ordersLeft: locals.user ? Math.max(0, MONTHLY_CAP - (await ordersThisMonth(locals.user.id))) : null,
		token: randomUUID()
	};
};

export const actions = {
	request: async ({ request, params, locals }) => {
		const user = signedIn(locals);
		if (!UUID.test(params.id)) error(404, 'Book not found');
		if (!user.city || !user.whatsapp) redirect(303, '/me');
		const form = await request.formData();
		const method = form.get('method');
		const rawAddress = form.get('address');
		const rawPin = form.get('pincode');
		const values = {
			method: typeof method === 'string' ? method : '',
			address: typeof rawAddress === 'string' ? rawAddress : '',
			pincode: typeof rawPin === 'string' ? rawPin : ''
		};
		if (method !== 'handover' && method !== 'post') return fail(400, { ...values, error: 'Choose how you want the book.' });
		const address = multiline(rawAddress, 500);
		const pin = pincode(rawPin);
		if (method === 'post' && (!address || address.length < 10 || !pin))
			return fail(400, { ...values, error: 'Enter your full delivery address and a 6-digit pincode.' });
		const raw = form.get('token');
		const token = typeof raw === 'string' && UUID.test(raw) ? raw : null;
		if (!allow(`request:${user.id}`, 10, 10)) return fail(429, { ...values, error: 'Too many requests. Try again later.' });
		let orderId = '';
		const failed = await attempt(async () => {
			orderId = (await createOrder(user.id, params.id, { method, address, pincode: pin, token })).id;
		}, values);
		if (failed) return failed;
		redirect(303, `/orders/${orderId}`);
	},

	report: async ({ request, params, locals }) => {
		const user = signedIn(locals);
		if (!UUID.test(params.id)) error(404, 'Book not found');
		const form = await request.formData();
		const reason = text(form.get('reason'), 500);
		if (!reason) return fail(400, { error: 'Tell us what is wrong (up to 500 characters).' });
		if (!allow(`report:${user.id}`, 10, 10)) return fail(429, { error: 'Too many reports. Try again later.' });
		const aboutUser = form.get('target') === 'user';
		const [l] = await sql`SELECT giver_id FROM listings WHERE id = ${params.id}`;
		if (!l) error(404, 'Book not found');
		await sql`INSERT INTO reports (reporter_id, listing_id, user_id, reason, subject)
			VALUES (${user.id}, ${params.id}, ${aboutUser ? l.giver_id : null}, ${reason}, ${aboutUser ? 'user' : 'listing'})`;
		return { reported: true };
	}
};
