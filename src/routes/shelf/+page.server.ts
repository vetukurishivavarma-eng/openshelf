import { error } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { ordersThisMonth, removeListing } from '$lib/server/engine';
import { attempt, signedIn } from '$lib/server/form';
import { UUID } from '$lib/server/validate';

export const load = async ({ locals }) => {
	const user = signedIn(locals);
	const books = await sql`SELECT id, title, author, status FROM listings
		WHERE owner_id = ${user.id} AND status <> 'removed' ORDER BY created_at DESC`;
	const received = await sql`SELECT o.id, l.title, l.author, o.status_at,
			EXISTS (SELECT 1 FROM listings n WHERE n.onward_from = o.id) AS onward
		FROM orders o JOIN listings l ON l.id = o.listing_id
		WHERE o.requester_id = ${user.id} AND o.status = 'received' ORDER BY o.status_at DESC LIMIT 50`;
	return {
		books: books.map((b) => ({ ...b })),
		received: received.map((r) => ({ ...r })),
		used: await ordersThisMonth(user.id)
	};
};

export const actions = {
	remove: async ({ request, locals }) => {
		const user = signedIn(locals);
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || !UUID.test(id)) error(400, 'Bad listing');
		return (await attempt(() => removeListing(user.id, id))) ?? { removed: true };
	}
};
