// Listings, orders, journeys, sweep. Lock order everywhere: order, then listing, then user.
// Providers are called after commit, never holding locks. Account closure cannot follow that
// order and relies on the deadlock retry in tx().
import { FEE_PAISE } from '../labels';
import { subHash } from './auth';
import { CourierStuck, bookPickup, cancelShipment, courierTestMode, quoteCourier, shipmentMoved } from './courier';
import { sql, tx, type Tx } from './db';
import { alertAdmins, notify } from './notify';
import { createGatewayOrder, flushRefunds, paymentsTestMode, queueRefund } from './payments';

export type Condition = 'like_new' | 'good' | 'worn';
export type Method = 'handover' | 'post';
export type Status =
	| 'requested' | 'paid' | 'pickup_booked' | 'in_transit' | 'delivered' | 'disputed'
	| 'declined' | 'cancelled' | 'expired' | 'received' | 'refunded';

const OPEN: Status[] = ['requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed'];
export const MONTHLY_CAP = 3;
const UNPAID_PER_HOUR = 5;
const WHATSAPP_DAYS_AFTER_END = 7;
const SWEEP_LOCK = 727002;
// A refunded or abandoned order was no book at all, but an accepted handover may have been.
const COUNTED: Status[] = ['requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed', 'received'];
// How long each state may last. Actions recheck these so a deadline holds between sweeps.
export const DEADLINE_HOURS: Partial<Record<Status, number>> = {
	requested: 0.5, paid: 72, pickup_booked: 120, in_transit: 504, delivered: 336
};
const DELETE_BLOCKED =
	'A courier has a book for one of your orders. You can delete your account once it has arrived.';

/** A refusal meant for the user. `stale` means a repeat of something that already happened. */
export class OrderError extends Error {
	constructor(message: string, readonly stale = false) {
		super(message);
	}
}

export type Order = {
	id: string;
	listing_id: string;
	giver_id: string;
	reader_id: string;
	method: Method;
	status: Status;
	status_at: Date;
	accepted_at: Date | null;
	fee_paise: number;
	courier_paise: number;
	total_paise: number;
	test_mode: boolean;
	gateway_order_id: string | null;
	payment_id: string | null;
	shipment_id: string | null;
	courier_order_id: string | null;
	address: string | null;
	pickup_address: string | null;
	delivery_pincode: string | null;
	pickup_pincode: string | null;
	disputed_from: Status | null;
	thank_you: string | null;
};

type OrderView = Order & {
	title: string;
	author: string;
	note: string | null;
	giver_name: string;
	reader_name: string;
	giver_whatsapp: string | null;
	reader_whatsapp: string | null;
	refund_status: string | null;
	onward_id: string | null;
};

const late = (o: Pick<Order, 'status' | 'status_at'>) => {
	const hours = DEADLINE_HOURS[o.status];
	return !!hours && Date.now() - o.status_at.getTime() > hours * 3_600_000;
};

/** The only place order status changes. Terminal states wipe everything private on the order. */
async function move(t: Tx, id: string, from: Status[], to: Status, note: string | null = null) {
	const open = OPEN.includes(to);
	const [order] = await t<Order[]>`
		UPDATE orders SET disputed_from = CASE WHEN ${to} = 'disputed' THEN status ELSE disputed_from END,
			status = ${to}, status_at = now(), warned_at = NULL,
			address = CASE WHEN ${open} THEN address END,
			pickup_address = CASE WHEN ${open} THEN pickup_address END,
			delivery_pincode = CASE WHEN ${open} THEN delivery_pincode END,
			pickup_pincode = CASE WHEN ${open} THEN pickup_pincode END,
			dispute_note = CASE WHEN ${open} THEN COALESCE(${note}, dispute_note) END
		WHERE id = ${id} AND status = ANY(${from})
		RETURNING *`;
	if (!order) throw new OrderError('This order has already moved on. Refresh to see where it stands.', true);
	return order;
}

/** Refund if money was taken, and put the book where it belongs. */
async function release(t: Tx, o: Order, listingStatus: 'available' | 'gone', reason: string) {
	await t`UPDATE listings SET status = ${listingStatus} WHERE id = ${o.listing_id}`;
	if (o.payment_id)
		await queueRefund(t, {
			orderId: o.id,
			paymentId: o.payment_id,
			amount: o.total_paise,
			reason,
			testMode: o.test_mode
		});
}

async function complete(t: Tx, o: Order) {
	await t`UPDATE listings SET status = 'gone' WHERE id = ${o.listing_id}`;
	await t`INSERT INTO journey_stops (journey_id, city, order_id)
		SELECT l.journey_id, u.city, ${o.id}::uuid FROM listings l, users u
		WHERE l.id = ${o.listing_id} AND u.id = ${o.reader_id} AND u.city IS NOT NULL
		ON CONFLICT (order_id) DO NOTHING`;
}

async function load(id: string, userId: string) {
	const [o] = await sql<Order[]>`SELECT * FROM orders WHERE id = ${id}`;
	if (!o || (o.giver_id !== userId && o.reader_id !== userId)) throw new OrderError('Order not found.');
	return o;
}

async function giverOnly(id: string, userId: string) {
	const o = await load(id, userId);
	if (o.giver_id !== userId) throw new OrderError('Only the giver can do that.');
	return o;
}

async function readerOnly(id: string, userId: string) {
	const o = await load(id, userId);
	if (o.reader_id !== userId) throw new OrderError('Only the reader can do that.');
	return o;
}

// Listings

async function activeUser(t: Tx, userId: string) {
	const [u] = await t`SELECT city, whatsapp, google_sub FROM users WHERE id = ${userId}
		AND banned_at IS NULL AND deleted_at IS NULL FOR UPDATE`;
	if (!u) throw new OrderError('Account unavailable.');
	if (!u.city || !u.whatsapp) throw new OrderError('Complete your profile first.');
	return u;
}

export async function createListing(
	userId: string,
	b: { title: string; author: string; isbn: string | null; condition: Condition; note: string | null; token?: string | null }
) {
	return tx(async (t) => {
		const u = await activeUser(t, userId);
		// The user lock above makes this a safe check: a repeat submit returns the first listing.
		if (b.token) {
			const [seen] = await t`SELECT id FROM listings WHERE giver_id = ${userId} AND request_token = ${b.token}`;
			if (seen) return seen.id as string;
		}
		const [l] = await t`INSERT INTO listings (giver_id, title, author, isbn, condition, note, request_token)
			VALUES (${userId}, ${b.title}, ${b.author}, ${b.isbn}, ${b.condition}, ${b.note}, ${b.token ?? null})
			RETURNING id, journey_id`;
		await t`INSERT INTO journey_stops (journey_id, city) VALUES (${l.journey_id}, ${u.city})`;
		return l.id as string;
	});
}

export async function removeListing(userId: string, listingId: string) {
	const rows = await sql`UPDATE listings SET status = 'removed'
		WHERE id = ${listingId} AND giver_id = ${userId} AND status = 'available' RETURNING id`;
	if (!rows.length) throw new OrderError('Only an available listing of yours can be removed.');
}

/** Relists the same copy, once, and its journey carries on. */
export async function giveOnward(userId: string, orderId: string, b: { condition: Condition; note: string | null }) {
	const o = await readerOnly(orderId, userId);
	return tx(async (t) => {
		await activeUser(t, userId);
		const [cur] = await t`SELECT status FROM orders WHERE id = ${orderId}`;
		if (cur.status !== 'received') throw new OrderError('You can give a book onward once you have received it.');
		const rows = await t`INSERT INTO listings (giver_id, title, author, isbn, condition, note, journey_id, onward_from)
			SELECT ${userId}, title, author, isbn, ${b.condition}, ${b.note}, journey_id, ${o.id}
			FROM listings WHERE id = ${o.listing_id}
			ON CONFLICT (onward_from) DO NOTHING RETURNING id`;
		if (!rows.length) throw new OrderError('You have already given this book onward.');
		return rows[0].id as string;
	});
}

// Orders

/** The same Google account after delete and return counts as the same reader. */
const countOrders = (q: Tx | typeof sql, userId: string, sub: string | null) => q`
	SELECT count(*)::int AS n FROM orders
	WHERE reader_id IN (SELECT id FROM users WHERE id = ${userId} OR deleted_sub_hash = ${sub ? subHash(sub) : ''})
	AND (status = ANY(${COUNTED}) OR (method = 'handover' AND accepted_at IS NOT NULL))
	AND (created_at AT TIME ZONE 'Asia/Kolkata') >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')`;

export async function ordersThisMonth(userId: string) {
	const [u] = await sql`SELECT google_sub FROM users WHERE id = ${userId}`;
	const [{ n }] = await countOrders(sql, userId, u?.google_sub ?? null);
	return n as number;
}

/** The price is computed here and only here; nothing a client sends reaches it. */
export async function createOrder(
	userId: string,
	listingId: string,
	d: { method: Method; address: string | null; pincode: string | null; token?: string | null }
) {
	const sent = async (q: Tx | typeof sql) =>
		d.token ? (await q<Order[]>`SELECT * FROM orders WHERE reader_id = ${userId} AND request_token = ${d.token}`)[0] : undefined;
	const repeat = await sent(sql);
	if (repeat) return repeat;

	const [seen] = await sql`SELECT l.status, l.giver_id, u.pincode, u.city FROM listings l JOIN users u ON u.id = l.giver_id
		WHERE l.id = ${listingId}`;
	if (!seen || seen.status !== 'available') {
		// A second fast click can arrive just after the first one reserved the book.
		const first = await sent(sql);
		if (first) return first;
		throw new OrderError('This book is no longer available.');
	}
	if (d.method === 'post' && (!d.address || !d.pincode)) throw new OrderError('Add your delivery address and pincode.');

	const courier = d.method === 'post' ? await quoteCourier(seen.pincode, d.pincode!) : 0;
	if (courier === null) throw new OrderError('No courier serves this route yet. Try a local handover.');

	const { order, repeated } = await tx(async (t) => {
		const [l] = await t`SELECT id, giver_id, status FROM listings WHERE id = ${listingId} FOR UPDATE`;
		// Under the listing lock, so the second of two fast clicks finds the first one's order.
		const again = await sent(t);
		if (again) return { order: again, repeated: true };
		if (!l || l.status !== 'available') throw new OrderError('This book is no longer available.');
		if (l.giver_id === userId) throw new OrderError('This is your own book.');

		// The user row lock serialises this count, which is what holds the cap under parallel requests.
		const u = await activeUser(t, userId);
		if (d.method === 'handover' && u.city !== seen.city)
			throw new OrderError(`Local handover is only for readers in ${seen.city}. Choose the courier.`);

		const [{ n }] = await countOrders(t, userId, u.google_sub);
		if (n >= MONTHLY_CAP)
			throw new OrderError(`You have reached the limit of ${MONTHLY_CAP} orders this month. It resets on the 1st.`);
		const [{ unpaid }] = await t`SELECT count(*)::int AS unpaid FROM orders WHERE reader_id = ${userId}
			AND payment_id IS NULL AND created_at > now() - interval '1 hour'`;
		if (unpaid >= UNPAID_PER_HOUR)
			throw new OrderError('You have started several orders without paying. Please try again in an hour.');

		const post = d.method === 'post';
		const [o] = await t<Order[]>`INSERT INTO orders
			(listing_id, giver_id, reader_id, method, fee_paise, courier_paise, test_mode, address,
				delivery_pincode, pickup_pincode, request_token)
			VALUES (${listingId}, ${l.giver_id}, ${userId}, ${d.method}, ${FEE_PAISE}, ${courier},
				${paymentsTestMode()}, ${post ? d.address : null}, ${post ? d.pincode : null},
				${post ? seen.pincode : null}, ${d.token ?? null})
			RETURNING *`;
		await t`UPDATE listings SET status = 'reserved' WHERE id = ${listingId}`;
		return { order: o, repeated: false };
	});
	if (repeated) return order;

	try {
		const gatewayId = await createGatewayOrder(order.id, order.total_paise);
		await sql`UPDATE orders SET gateway_order_id = ${gatewayId} WHERE id = ${order.id}`;
		return { ...order, gateway_order_id: gatewayId };
	} catch (e) {
		console.error('[order]', order.id, e);
		await cancelOrder(userId, order.id).catch(() => {});
		throw new OrderError('Payments are unavailable right now. Please try again shortly.');
	}
}

/** Called by the webhook, in its transaction. Returns the order id if a refund may be waiting. */
export async function applyCapture(
	t: Tx,
	p: { gatewayOrderId: string; paymentId: string; amount: number; currency: string }
) {
	const [o] = await t<Order[]>`SELECT * FROM orders WHERE gateway_order_id = ${p.gatewayOrderId} FOR UPDATE`;
	if (!o) {
		console.error('[webhook] unknown order', p.gatewayOrderId);
		return null;
	}
	if (o.payment_id === p.paymentId) return null; // payment.captured and order.paid both report it.

	const right = p.amount === o.total_paise && p.currency === 'INR';
	if (right && o.status === 'requested' && !o.payment_id && !late(o)) {
		await t`UPDATE orders SET payment_id = ${p.paymentId} WHERE id = ${o.id}`;
		await move(t, o.id, ['requested'], 'paid');
		void notify(o.giver_id, 'Someone wants your book', 'A reader has paid. Accept within 72 hours.');
		return null;
	}
	// Money arrived that we cannot honour: wrong amount, or too late. It goes straight back.
	if (Number.isInteger(p.amount) && p.amount > 0)
		await queueRefund(t, {
			orderId: o.id,
			paymentId: p.paymentId,
			amount: p.amount,
			reason: right ? 'payment after the order closed' : 'wrong amount',
			testMode: o.test_mode
		});
	console.error('[webhook] refused payment', o.id, o.status, p.amount, p.currency);
	return o.id;
}

async function toAdmin(id: string, from: Status[], note: string) {
	const o = await tx((t) => move(t, id, from, 'disputed', note));
	void notify(o.reader_id, 'An admin is reviewing your order', note);
	void notify(o.giver_id, 'An admin is reviewing an order', note);
	void alertAdmins('Order needs a decision', `${id}: ${note}`);
	return o;
}

export async function acceptOrder(userId: string, id: string, pickupAddress: string | null) {
	const current = await giverOnly(id, userId);
	if (current.method === 'post' && !pickupAddress) throw new OrderError('Add the address the courier should collect from.');
	if (current.status === 'paid' && late(current)) throw new OrderError('The 72 hours to accept have passed.');
	const o = await tx(async (t) => {
		const o = await move(t, id, ['paid'], 'pickup_booked');
		await t`UPDATE orders SET accepted_at = now(), pickup_address = ${o.method === 'post' ? pickupAddress : null} WHERE id = ${id}`;
		return o;
	});
	void notify(o.reader_id, 'Your order was accepted', 'Open the order for what happens next.');
	if (o.method !== 'post') return;

	try {
		const [p] = await sql`SELECT o.address, o.delivery_pincode, o.pickup_pincode, l.title,
				g.name AS g_name, g.whatsapp AS g_phone, g.city AS g_city,
				r.name AS r_name, r.whatsapp AS r_phone, r.city AS r_city
			FROM orders o JOIN listings l ON l.id = o.listing_id
			JOIN users g ON g.id = o.giver_id JOIN users r ON r.id = o.reader_id
			WHERE o.id = ${id}`;
		const booked = await bookPickup(
			{
				orderId: id,
				title: p.title,
				giver: { name: p.g_name, phone: p.g_phone, address: pickupAddress!, city: p.g_city, pincode: p.pickup_pincode },
				reader: { name: p.r_name, phone: p.r_phone, address: p.address, city: p.r_city, pincode: p.delivery_pincode }
			},
			o.test_mode
		);
		const [still] = await sql`UPDATE orders SET shipment_id = ${booked.shipmentId}, courier_order_id = ${booked.courierOrderId}
			WHERE id = ${id} RETURNING status`;
		// The order closed while the booking was in flight, so nothing else will stop this shipment.
		if (still.status !== 'pickup_booked' && !o.test_mode)
			await cancelShipment(booked.courierOrderId).catch(() =>
				alertAdmins('Shipment left running', `Order ${id} closed during booking. Cancel ${booked.shipmentId} by hand.`)
			);
	} catch (e) {
		console.error('[courier]', id, e);
		if (e instanceof CourierStuck) await toAdmin(id, ['pickup_booked'], 'The courier booking failed halfway.');
		else await pickupFailed(id);
	}
}

export async function declineOrder(userId: string, id: string) {
	await giverOnly(id, userId);
	const o = await tx(async (t) => {
		const o = await move(t, id, ['paid'], 'declined');
		await release(t, o, 'available', 'declined by the giver');
		return o;
	});
	await flushRefunds(id);
	void notify(o.reader_id, 'Your order was declined', 'Your payment is being refunded in full.');
}

export async function cancelOrder(userId: string, id: string) {
	const current = await load(id, userId);
	// Once a handover is agreed the book may be in the reader's hands, so only the giver can undo it.
	const from: Status[] =
		current.reader_id === userId ? ['requested', 'paid'] : current.method === 'handover' ? ['pickup_booked'] : [];
	if (!from.length) throw new OrderError('This order cannot be cancelled now.');
	if (!from.includes(current.status) && current.status === 'pickup_booked')
		throw new OrderError('Only the giver can cancel an agreed handover. If something is wrong, raise a dispute.');
	const o = await tx(async (t) => {
		const o = await move(t, id, from, 'cancelled');
		await release(t, o, 'available', 'cancelled');
		return o;
	});
	await flushRefunds(id);
	if (o.payment_id)
		void notify(o.reader_id === userId ? o.giver_id : o.reader_id, 'An order was cancelled', 'The payment is being refunded in full.');
}

export async function markHandedOver(userId: string, id: string) {
	const current = await giverOnly(id, userId);
	if (current.method !== 'handover') throw new OrderError('The courier updates this order.');
	if (current.status === 'pickup_booked' && late(current)) throw new OrderError('The time for this handover has passed.');
	const o = await tx((t) => move(t, id, ['pickup_booked'], 'delivered'));
	void notify(o.reader_id, 'Your book was handed over', 'Confirm you have it, or raise a problem.');
}

/** Refund a booked courier order, but only once the courier has really stopped. */
export async function pickupFailed(id: string, reason = 'pickup failed') {
	const [current] = await sql<Order[]>`SELECT * FROM orders WHERE id = ${id}`;
	if (current?.status !== 'pickup_booked') throw new OrderError('This order has already moved on.', true);

	let stopped = current.test_mode || !current.shipment_id;
	let why = 'The courier may still have this book.';
	if (!stopped) {
		try {
			if (await shipmentMoved(current.shipment_id!)) why = 'The courier reports this book has moved.';
			else {
				await cancelShipment(current.courier_order_id!);
				stopped = true;
			}
		} catch (e) {
			console.error('[courier]', id, e);
			why = 'The courier booking could not be cancelled.';
		}
	}
	if (!stopped) return void (await toAdmin(id, ['pickup_booked'], why));

	const o = await tx(async (t) => {
		const o = await move(t, id, ['pickup_booked'], 'refunded');
		await release(t, o, 'available', reason);
		return o;
	});
	await flushRefunds(id);
	void notify(o.reader_id, 'The pickup failed', 'Your payment is being refunded in full.');
	void notify(o.giver_id, 'The pickup failed', 'The book is back on your shelf.');
}

/** Courier scans arrive late, twice and out of order; anything already past the step is ignored. */
export async function courierEvent(shipmentId: string, kind: 'picked_up' | 'delivered' | 'failed') {
	const [o] = await sql<Order[]>`SELECT * FROM orders WHERE shipment_id = ${shipmentId}`;
	if (!o) return false;
	try {
		if (kind === 'picked_up' && o.status === 'pickup_booked') {
			await tx((t) => move(t, o.id, ['pickup_booked'], 'in_transit'));
			void notify(o.reader_id, 'Your book is on its way', 'The courier has collected it.');
		} else if (kind === 'delivered' && (o.status === 'pickup_booked' || o.status === 'in_transit')) {
			await tx((t) => move(t, o.id, ['pickup_booked', 'in_transit'], 'delivered'));
			void notify(o.reader_id, 'Your book was delivered', 'Confirm you have it, or raise a problem.');
		} else if (kind === 'failed' && o.status === 'pickup_booked') {
			await pickupFailed(o.id);
		} else if (kind === 'failed' && o.status === 'in_transit') {
			await toAdmin(o.id, ['in_transit'], 'The courier reported a delivery failure.');
		}
	} catch (e) {
		if (!(e instanceof OrderError)) throw e;
	}
	return true;
}

async function confirm(id: string) {
	return tx(async (t) => {
		const o = await move(t, id, ['delivered'], 'received');
		await complete(t, o);
		return o;
	});
}

/** Past its deadline this still ends as received, which is what the sweep would do anyway. */
export async function confirmReceived(userId: string, id: string) {
	await readerOnly(id, userId);
	const o = await confirm(id);
	void notify(o.giver_id, 'Your book reached its next reader', 'A thank-you may follow.');
}

export async function disputeOrder(userId: string, id: string, note: string) {
	const current = await readerOnly(id, userId);
	if (current.status === 'delivered' && late(current)) throw new OrderError('The time to raise a problem has passed.');
	const from: Status[] = current.method === 'handover' ? ['pickup_booked', 'delivered'] : ['in_transit', 'delivered'];
	const o = await tx((t) => move(t, id, from, 'disputed', note));
	void notify(o.giver_id, 'An order was disputed', 'An admin will review it.');
}

/** Caller must have checked the admin role. `refunded` upholds the dispute. */
export async function resolveDispute(id: string, outcome: 'received' | 'refunded') {
	const o = await tx(async (t) => {
		const o = await move(t, id, ['disputed'], outcome);
		if (outcome === 'received') await complete(t, o);
		else await release(t, o, 'gone', 'dispute upheld'); // Its whereabouts are unknown, so it does not relist.
		return o;
	});
	await flushRefunds(id);
	const text = outcome === 'received' ? 'The order stands as completed.' : 'The payment is being refunded in full.';
	void notify(o.giver_id, 'Dispute resolved', text);
	void notify(o.reader_id, 'Dispute resolved', text);
}

export async function sendThanks(userId: string, id: string, message: string) {
	const o = await readerOnly(id, userId);
	const rows = await sql`UPDATE orders SET thank_you = ${message}, thanked_at = now()
		WHERE id = ${id} AND status = 'received' AND thank_you IS NULL RETURNING id`;
	if (!rows.length) throw new OrderError('A thank-you can be sent once, after the book arrives.');
	void notify(o.giver_id, 'A thank-you for your book', 'Open the order to read it.');
}

/** A viewer-scoped order: null for non-parties. Each private field has its own rule. */
export async function orderFor(id: string, viewerId: string) {
	const [o] = await sql<OrderView[]>`
		SELECT o.*, l.title, l.author, l.note,
			split_part(g.name, ' ', 1) AS giver_name, split_part(r.name, ' ', 1) AS reader_name,
			g.whatsapp AS giver_whatsapp, r.whatsapp AS reader_whatsapp,
			(SELECT status FROM refunds f WHERE f.order_id = o.id ORDER BY created_at LIMIT 1) AS refund_status,
			(SELECT id FROM listings n WHERE n.onward_from = o.id) AS onward_id
		FROM orders o
		JOIN listings l ON l.id = o.listing_id
		JOIN users g ON g.id = o.giver_id
		JOIN users r ON r.id = o.reader_id
		WHERE o.id = ${id} AND ${viewerId} IN (o.giver_id, o.reader_id)`;
	if (!o) return null;
	const isGiver = o.giver_id === viewerId;
	const accepted = !!o.accepted_at;
	const open = ['pickup_booked', 'in_transit', 'delivered', 'disputed'].includes(o.status);
	const recentlyDone =
		o.status === 'received' && Date.now() - o.status_at.getTime() < WHATSAPP_DAYS_AFTER_END * 86_400_000;
	const shared = open || recentlyDone;
	return {
		id: o.id,
		status: o.status,
		status_at: o.status_at,
		method: o.method,
		title: o.title,
		author: o.author,
		listing_id: o.listing_id,
		disputed_from: o.disputed_from,
		paid: !!o.payment_id,
		giver_name: isGiver || accepted ? o.giver_name : null,
		reader_name: o.reader_name,
		role: isGiver ? ('giver' as const) : ('reader' as const),
		thank_you: o.thank_you,
		onward_id: o.onward_id,
		refund_status: o.refund_status,
		test_mode: o.test_mode,
		whatsapp: shared ? (isGiver ? o.reader_whatsapp : o.giver_whatsapp) : null,
		note: isGiver || accepted ? o.note : null,
		// The courier needs these; the other reader never does.
		address: isGiver ? null : o.address,
		pickup_address: isGiver ? o.pickup_address : null,
		fee_paise: isGiver ? null : o.fee_paise,
		courier_paise: isGiver ? null : o.courier_paise,
		total_paise: isGiver ? null : o.total_paise,
		gateway_order_id: isGiver ? null : o.gateway_order_id
	};
}

// Accounts

/** Shared by ban and delete, in the caller's transaction, after the user row is marked. */
async function closeAccount(t: Tx, userId: string, deleting: boolean) {
	await t`DELETE FROM sessions WHERE user_id = ${userId}`;
	// Stop new orders first; anything already in flight is then visible to the query below.
	await t`UPDATE listings SET status = 'removed' WHERE giver_id = ${userId} AND status = 'available'`;
	const open = await t<{ id: string; status: Status; method: Method }[]>`SELECT id, status, method FROM orders
		WHERE status IN ('requested', 'paid', 'pickup_booked', 'in_transit') AND ${userId} IN (giver_id, reader_id)
		FOR UPDATE`;
	const moved: Order[] = [];
	for (const { id, status, method } of open) {
		if (status === 'requested' || status === 'paid') {
			const o = await move(t, id, [status], 'cancelled');
			await release(t, o, 'available', 'account closed');
			moved.push(o);
			continue;
		}
		if (deleting && method === 'post') throw new OrderError(DELETE_BLOCKED);
		// The book may already have moved, so a person decides. Never an automatic refund here.
		moved.push(await move(t, id, [status], 'disputed', 'One of the two accounts closed during this order.'));
	}
	// Whatever stays open reaches the reader and ends by confirmation or an admin; the private details go now.
	await t`UPDATE orders SET address = NULL, delivery_pincode = NULL WHERE reader_id = ${userId}`;
	await t`UPDATE orders SET pickup_address = NULL, pickup_pincode = NULL WHERE giver_id = ${userId}`;
	await t`UPDATE listings SET status = 'removed' WHERE giver_id = ${userId} AND status = 'available'`;
	return moved;
}

async function afterClose(moved: Order[], userId: string) {
	for (const o of moved) {
		await flushRefunds(o.id);
		if (!o.payment_id) continue;
		const review = o.status === 'disputed';
		void notify(
			o.giver_id === userId ? o.reader_id : o.giver_id,
			review ? 'An admin is reviewing your order' : 'An order was cancelled',
			review ? 'The other account closed during this order.' : 'The other account closed. The payment is being refunded in full.'
		);
		if (review) void alertAdmins('Order needs a decision', `${o.id}: an account closed during this order.`);
	}
}

export async function banUser(userId: string) {
	const moved = await tx(async (t) => {
		await t`UPDATE users SET banned_at = COALESCE(banned_at, now()) WHERE id = ${userId}`;
		return closeAccount(t, userId, false);
	});
	await afterClose(moved, userId);
}

export async function deleteAccount(userId: string) {
	const moved = await tx(async (t) => {
		const [u] = await t`SELECT google_sub, deleted_sub_hash FROM users WHERE id = ${userId} FOR UPDATE`;
		// Kept so that a ban and the monthly limit still hold if the same Google account comes back.
		await t`UPDATE users SET deleted_at = now(), name = 'Former reader', google_sub = NULL,
			deleted_sub_hash = ${u.google_sub ? subHash(u.google_sub) : u.deleted_sub_hash},
			email = NULL, city = NULL, pincode = NULL, whatsapp = NULL WHERE id = ${userId}`;
		await t`UPDATE listings SET note = NULL WHERE giver_id = ${userId}`;
		await t`UPDATE orders SET thank_you = NULL WHERE reader_id = ${userId}`;
		await t`UPDATE orders SET dispute_note = NULL WHERE reader_id = ${userId} AND status <> 'disputed'`;
		await t`UPDATE reports SET reason = 'Removed when the account was deleted' WHERE reporter_id = ${userId}`;
		return closeAccount(t, userId, true);
	});
	await afterClose(moved, userId);
}

/** After going live: orders that were only ever pretend must not linger. No provider is called. */
export async function cancelTestOrders() {
	const open = await sql<{ id: string; status: Status }[]>`SELECT id, status FROM orders
		WHERE test_mode AND status = ANY(${OPEN})`;
	for (const { id, status } of open) {
		await tx(async (t) => {
			const o = await move(t, id, [status], 'cancelled');
			await release(t, o, 'available', 'test order closed when going live');
			await t`UPDATE listings l SET status = 'removed' FROM users u
				WHERE l.id = ${o.listing_id} AND u.id = l.giver_id AND (u.banned_at IS NOT NULL OR u.deleted_at IS NOT NULL)`;
		});
		await flushRefunds(id);
	}
	return open.length;
}

// Timers

/** Idempotent. Returns false when another sweep holds the lock. */
export async function sweep() {
	const conn = await sql.reserve();
	try {
		const [{ locked }] = await conn`SELECT pg_try_advisory_lock(${SWEEP_LOCK}) AS locked`;
		if (!locked) return false;
		try {
			const due = await sql<{ id: string; status: Status; method: Method }[]>`SELECT id, status, method FROM orders
				WHERE (status = 'requested' AND status_at < now() - interval '30 minutes')
					OR (status = 'paid' AND status_at < now() - interval '72 hours')
					OR (status = 'pickup_booked' AND status_at < now() - interval '5 days')
					OR (status = 'in_transit' AND status_at < now() - interval '21 days')
					OR (status = 'delivered' AND status_at < now() - interval '14 days')`;
			for (const { id, status, method } of due) {
				try {
					if (status === 'delivered') {
						const o = await confirm(id);
						void notify(o.giver_id, 'Your book reached its next reader', 'The order confirmed itself after 14 days.');
					} else if (status === 'in_transit') {
						await toAdmin(id, ['in_transit'], 'No delivery scan for 21 days.');
					} else if (status === 'pickup_booked' && method === 'post') {
						await pickupFailed(id, 'pickup timed out');
					} else if (status === 'pickup_booked') {
						await toAdmin(id, ['pickup_booked'], 'The handover was not confirmed in time.');
					} else {
						const o = await tx(async (t) => {
							const o = await move(t, id, [status], 'expired');
							await release(t, o, 'available', 'no response in time');
							return o;
						});
						await flushRefunds(id);
						if (o.payment_id) {
							void notify(o.reader_id, 'Your order expired', 'Your payment is being refunded in full.');
							void notify(o.giver_id, 'An order expired', 'The book is available again.');
						}
					}
				} catch (e) {
					// A party got there first; the guard did its job. One bad row must not stop the rest.
					if (!(e instanceof OrderError)) console.error('[sweep]', id, e);
				}
			}
			const warn = await sql<{ status: Status; method: Method; giver_id: string; reader_id: string }[]>`
				UPDATE orders SET warned_at = now()
				WHERE warned_at IS NULL AND (
					(status = 'paid' AND status_at < now() - interval '48 hours')
					OR (status = 'pickup_booked' AND status_at < now() - interval '4 days')
					OR (status = 'delivered' AND status_at < now() - interval '13 days'))
				RETURNING status, method, giver_id, reader_id`;
			for (const w of warn) {
				if (w.status === 'delivered')
					void notify(w.reader_id, 'Order closes tomorrow', 'It confirms itself in a day unless you raise a problem.');
				else if (w.status === 'paid')
					void notify(w.giver_id, 'Order expires tomorrow', 'Accept or decline within a day, or it is refunded.');
				else if (w.method === 'post')
					void notify(w.reader_id, 'The courier has not collected yet', 'There is nothing you need to do. We are watching it.');
				else void notify(w.giver_id, 'Handover due tomorrow', 'Hand the book over, or an admin will review the order.');
			}
			await flushRefunds();
			await sql`DELETE FROM sessions WHERE expires_at < now()`;
			return true;
		} finally {
			await conn`SELECT pg_advisory_unlock(${SWEEP_LOCK})`;
		}
	} finally {
		conn.release();
	}
}

/** For the UI's test-mode label. */
export const testMode = () => paymentsTestMode() || courierTestMode();
