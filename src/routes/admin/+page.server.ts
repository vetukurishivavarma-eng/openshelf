import { error, fail } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import { banUser, resolveDispute } from '$lib/server/engine';
import { retryRefund } from '$lib/server/payments';
import { attempt, signedIn } from '$lib/server/form';
import { UUID } from '$lib/server/validate';

function admin(locals: App.Locals) {
	const user = signedIn(locals);
	if (!user.isAdmin) error(404, 'Not found');
}

const uuid = (form: FormData, key: string) => {
	const v = form.get(key);
	if (typeof v !== 'string' || !UUID.test(v)) error(400, 'Bad id');
	return v;
};

export const load = async ({ locals }) => {
	admin(locals);
	const disputes = await sql`
		SELECT s.id, s.dispute_note, s.status_at, s.total_paise, s.method, l.title,
			split_part(o.name, ' ', 1) AS giver_name, split_part(r.name, ' ', 1) AS reader_name
		FROM orders s JOIN listings l ON l.id = s.listing_id
		JOIN users o ON o.id = s.giver_id JOIN users r ON r.id = s.reader_id
		WHERE s.status = 'disputed' ORDER BY s.status_at`;
	const reports = await sql`
		SELECT rp.id, rp.reason, rp.created_at, rp.listing_id, rp.subject, l.title, l.status AS listing_status,
			CASE rp.subject WHEN 'note' THEN l.note WHEN 'thank_you' THEN o.thank_you END AS message,
			COALESCE(rp.user_id, l.giver_id) AS target_id,
			split_part(t.name, ' ', 1) AS target_name, t.banned_at IS NOT NULL AS banned
		FROM reports rp LEFT JOIN listings l ON l.id = rp.listing_id
		LEFT JOIN orders o ON o.id = rp.order_id
		JOIN users t ON t.id = COALESCE(rp.user_id, l.giver_id)
		WHERE rp.resolved_at IS NULL ORDER BY rp.created_at`;
	const refunds = await sql`SELECT f.id, f.order_id, f.amount_paise, f.reason, f.status, f.attempts, f.created_at
		FROM refunds f WHERE f.status IN ('pending', 'processing', 'failed') ORDER BY f.created_at`;
	return {
		disputes: disputes.map((d) => ({ ...d })),
		reports: reports.map((r) => ({ ...r })),
		refunds: refunds.map((r) => ({ ...r }))
	};
};

export const actions = {
	resolve: async ({ request, locals }) => {
		admin(locals);
		const form = await request.formData();
		const outcome = form.get('outcome');
		if (outcome !== 'received' && outcome !== 'refunded') return fail(400, { error: 'Choose an outcome.' });
		const id = uuid(form, 'id');
		return (await attempt(() => resolveDispute(id, outcome))) ?? { ok: true };
	},

	close: async ({ request, locals }) => {
		admin(locals);
		const id = uuid(await request.formData(), 'id');
		await sql`UPDATE reports SET resolved_at = now() WHERE id = ${id}`;
		return { ok: true };
	},

	retry: async ({ request, locals }) => {
		admin(locals);
		const id = uuid(await request.formData(), 'id');
		if (!(await retryRefund(id))) return fail(400, { error: 'Only a failed refund can be retried.' });
		return { ok: true };
	},

	// Only an available listing: one in an order goes through the order, or a ban.
	takedown: async ({ request, locals }) => {
		admin(locals);
		const form = await request.formData();
		const rows = await sql`UPDATE listings SET status = 'removed'
			WHERE id = ${uuid(form, 'listing')} AND status = 'available' RETURNING id`;
		if (!rows.length) return fail(400, { error: 'That listing is in an order or already gone.' });
		await sql`UPDATE reports SET resolved_at = now() WHERE id = ${uuid(form, 'id')}`;
		return { ok: true };
	},

	// Removes a reported note or thank-you, and nothing else.
	cleartext: async ({ request, locals }) => {
		admin(locals);
		const id = uuid(await request.formData(), 'id');
		const [r] = await sql`SELECT subject, listing_id, order_id FROM reports WHERE id = ${id}`;
		if (r?.subject === 'note') await sql`UPDATE listings SET note = NULL WHERE id = ${r.listing_id}`;
		if (r?.subject === 'thank_you') await sql`UPDATE orders SET thank_you = NULL WHERE id = ${r.order_id}`;
		await sql`UPDATE reports SET resolved_at = now() WHERE id = ${id}`;
		return { ok: true };
	},

	ban: async ({ request, locals }) => {
		admin(locals);
		const form = await request.formData();
		await banUser(uuid(form, 'user'));
		await sql`UPDATE reports SET resolved_at = now() WHERE id = ${uuid(form, 'id')}`;
		return { ok: true };
	}
};
