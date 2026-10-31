import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { sql } from '$lib/server/db';
import {
	acceptOrder, cancelOrder, confirmReceived, courierEvent, declineOrder, disputeOrder, giveOnward,
	markHandedOver, orderFor, sendThanks, testMode
} from '$lib/server/engine';
import type { Condition } from '$lib/server/engine';
import { attempt, signedIn } from '$lib/server/form';
import { paymentsTestMode, simulatePayment } from '$lib/server/payments';
import { NOTE_MAX, UUID, text } from '$lib/server/validate';

export const load = async ({ params, locals }) => {
	const user = signedIn(locals);
	if (!UUID.test(params.id)) error(404, 'Order not found');
	const order = await orderFor(params.id, user.id);
	if (!order || (order.role === 'owner' && order.status === 'requested')) error(404, 'Order not found');
	return {
		order,
		testControls: testMode() && order.test_mode,
		// The public half of the key pair; the page cannot pay without it.
		razorpayKey: paymentsTestMode() ? null : process.env.RAZORPAY_KEY_ID
	};
};

type Event = RequestEvent<{ id: string }>;

function context({ params, locals }: Event) {
	const user = signedIn(locals);
	if (!UUID.test(params.id)) error(404, 'Order not found');
	return { user, id: params.id };
}

/** The engine does the party check; this adds sign-in and input shape. */
const act = (fn: (userId: string, id: string) => Promise<unknown>) => async (event: Event) => {
	const { user, id } = context(event);
	return (await attempt(() => fn(user.id, id))) ?? { ok: true };
};

export const actions = {
	decline: act(declineOrder),
	cancel: act(cancelOrder),
	handover: act(markHandedOver),
	received: act(confirmReceived),

	accept: async (event) => {
		const { user, id } = context(event);
		const raw = (await event.request.formData()).get('pickup_address');
		const address = typeof raw === 'string' ? raw.trim() : '';
		if (address.length > 500) return fail(400, { error: 'Keep the address to 500 characters.' });
		return (await attempt(() => acceptOrder(user.id, id, address || null))) ?? { ok: true };
	},

	dispute: async (event) => {
		const { user, id } = context(event);
		const note = text((await event.request.formData()).get('note'), 500);
		if (!note) return fail(400, { error: 'Tell us what went wrong (up to 500 characters).' });
		return (await attempt(() => disputeOrder(user.id, id, note))) ?? { ok: true };
	},

	thanks: async (event) => {
		const { user, id } = context(event);
		const message = text((await event.request.formData()).get('message'), NOTE_MAX);
		if (!message) return fail(400, { error: `Write a thank-you of up to ${NOTE_MAX} characters.` });
		return (await attempt(() => sendThanks(user.id, id, message))) ?? { ok: true };
	},

	onward: async (event) => {
		const { user, id } = context(event);
		const form = await event.request.formData();
		const condition = form.get('condition');
		if (condition !== 'like_new' && condition !== 'good' && condition !== 'worn')
			return fail(400, { error: 'Choose a condition.' });
		const raw = form.get('note');
		const note = text(raw, NOTE_MAX);
		if (typeof raw === 'string' && raw.trim() && !note)
			return fail(400, { error: `Keep your note to ${NOTE_MAX} characters.` });
		let listingId = '';
		const failed = await attempt(async () => {
			listingId = await giveOnward(user.id, id, { condition: condition as Condition, note });
		});
		if (failed) return failed;
		redirect(303, `/books/${listingId}`);
	},

	report: async (event) => {
		const { user, id } = context(event);
		const form = await event.request.formData();
		const reason = text(form.get('reason'), 500);
		if (!reason) return fail(400, { error: 'Tell us what is wrong (up to 500 characters).' });
		const order = await orderFor(id, user.id);
		if (!order) error(404, 'Order not found');
		// Each reader can report only what the other one wrote.
		const subject = order.role === 'owner' ? 'thank_you' : 'note';
		await sql`INSERT INTO reports (reporter_id, order_id, listing_id, user_id, reason, subject)
			SELECT ${user.id}, o.id, o.listing_id, CASE WHEN o.owner_id = ${user.id} THEN o.requester_id ELSE o.owner_id END,
				${reason}, ${subject}
			FROM orders o WHERE o.id = ${id}`;
		return { reported: true };
	},

	testpay: async (event) => {
		const { user, id } = context(event);
		if (!paymentsTestMode()) error(404, 'Not found');
		const [o] = await sql`SELECT gateway_order_id, total_paise FROM orders
			WHERE id = ${id} AND requester_id = ${user.id} AND status = 'requested' AND test_mode`;
		if (!o) return fail(400, { error: 'This order cannot be paid.' });
		await simulatePayment({ gateway_order_id: o.gateway_order_id, total_paise: o.total_paise });
		return { ok: true };
	},

	testcourier: async (event) => {
		const { user, id } = context(event);
		const kind = (await event.request.formData()).get('kind');
		if (!testMode() || (kind !== 'picked_up' && kind !== 'delivered' && kind !== 'failed')) error(404, 'Not found');
		const [o] = await sql`SELECT shipment_id FROM orders
			WHERE id = ${id} AND test_mode AND ${user.id} IN (owner_id, requester_id)`;
		if (!o?.shipment_id) return fail(400, { error: 'This order has no courier booking.' });
		await courierEvent(o.shipment_id, kind);
		return { ok: true };
	}
};
