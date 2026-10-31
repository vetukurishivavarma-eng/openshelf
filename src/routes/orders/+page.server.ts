import { sql } from '$lib/server/db';
import { signedIn } from '$lib/server/form';

export const load = async ({ locals }) => {
	const user = signedIn(locals);
	// A giver hears about an order once it is paid, so unpaid ones are the reader's alone.
	const orders = await sql`SELECT o.id, o.status, o.method, l.title, o.owner_id = ${user.id} AS mine
		FROM orders o JOIN listings l ON l.id = o.listing_id
		WHERE o.requester_id = ${user.id} OR (o.owner_id = ${user.id} AND o.status <> 'requested')
		ORDER BY o.status_at DESC LIMIT 100`;
	return { orders: orders.map((o) => ({ ...o })) };
};
