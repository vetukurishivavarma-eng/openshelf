import { sql } from '$lib/server/db';
import { signedIn } from '$lib/server/form';

export const load = async ({ locals }) => {
	const user = signedIn(locals);
	// A giver hears about an order once it is paid, so unpaid ones are the reader's alone.
	const orders = await sql`SELECT o.id, o.status, o.method, l.title, o.giver_id = ${user.id} AS mine
		FROM orders o JOIN listings l ON l.id = o.listing_id
		WHERE o.reader_id = ${user.id} OR (o.giver_id = ${user.id} AND o.payment_id IS NOT NULL)
		ORDER BY o.status_at DESC LIMIT 100`;
	return { orders: orders.map((o) => ({ ...o })) };
};
