import { expect } from 'vitest';
import { sql } from '../src/lib/server/db';
import {
	acceptOrder, cancelOrder, confirmReceived, courierEvent, createOrder, declineOrder, disputeOrder,
	markHandedOver, resolveDispute, sweep, type Method, type Status
} from '../src/lib/server/engine';
import { flushRefunds, simulatePayment } from '../src/lib/server/payments';

let n = 0;
export const ADDRESS = '12 MG Road, Pune';
export const PICKUP = '4 Lake View, Pune';

export async function newUser(name = 'Test Reader', city = 'Pune') {
	const i = ++n;
	const [u] = await sql`INSERT INTO users (google_sub, email, name, city, pincode, whatsapp)
		VALUES (${`t${i}-${process.pid}-${Date.now()}`}, ${`t${i}-${process.pid}@x.test`}, ${name}, ${city}, '411001',
			${`+919${String(process.pid % 1000).padStart(3, '0')}${String(i).padStart(6, '0')}`})
		RETURNING id`;
	return u.id as string;
}

export async function newListing(ownerId: string, note: string | null = null) {
	const [o] = await sql`SELECT city FROM users WHERE id = ${ownerId}`;
	const [l] = await sql`INSERT INTO listings (owner_id, title, author, condition, note)
		VALUES (${ownerId}, 'A Book', 'An Author', 'good', ${note}) RETURNING id, journey_id`;
	await sql`INSERT INTO journey_stops (journey_id, city) VALUES (${l.journey_id}, ${o.city})`;
	return l.id as string;
}

export const details = (method: Method) =>
	method === 'post' ? { method, address: ADDRESS, pincode: '560001' } : { method, address: null, pincode: null };

export async function row(id: string) {
	const [o] = await sql`SELECT * FROM orders WHERE id = ${id}`;
	return o;
}

export async function status(id: string) {
	return (await row(id)).status as Status;
}

export async function listingStatus(id: string) {
	const [l] = await sql`SELECT status FROM listings WHERE id = ${id}`;
	return l.status as string;
}

export async function refundsFor(orderId: string) {
	return [...(await sql`SELECT * FROM refunds WHERE order_id = ${orderId}`)];
}

export async function backdate(id: string, age: string) {
	await sql`UPDATE orders SET status_at = now() - ${age}::interval WHERE id = ${id}`;
}

export async function pay(id: string) {
	const o = await row(id);
	return simulatePayment({ gateway_order_id: o.gateway_order_id, total_paise: o.total_paise });
}

/** A fresh order driven to `target` through the real engine. */
export async function orderAt(target: Status, method: Method = 'post') {
	const owner = await newUser();
	const requester = await newUser();
	const listing = await newListing(owner);
	const { id } = await createOrder(requester, listing, details(method));
	const ids = { id, owner, requester, listing, method };
	if (target === 'requested') return ids;
	await pay(id);
	if (target === 'paid') return ids;
	if (target === 'declined') return await declineOrder(owner, id), ids;
	if (target === 'cancelled') return await cancelOrder(requester, id), ids;
	if (target === 'expired') {
		await backdate(id, '73 hours');
		await sweep();
		return ids;
	}
	await acceptOrder(owner, id, method === 'post' ? PICKUP : null);
	if (target === 'pickup_booked') return ids;
	const shipment = (await row(id)).shipment_id;
	if (method === 'handover') await markHandedOver(owner, id);
	else {
		await courierEvent(shipment, 'picked_up');
		if (target === 'in_transit') return ids;
		await courierEvent(shipment, 'delivered');
	}
	if (target === 'delivered') return ids;
	if (target === 'received') return await confirmReceived(requester, id), ids;
	await disputeOrder(requester, id, 'Never arrived');
	if (target === 'refunded') await resolveDispute(id, 'refunded');
	return ids;
}

/**
 * The invariant replacing credits = SUM(delta): a paid order that closed without completing has
 * exactly one full refund, and a paid order that is open or completed has none.
 */
export async function expectMoneyIntact() {
	await flushRefunds();
	const owed = await sql`SELECT o.id, o.status, count(f.id)::int AS refunds FROM orders o
		LEFT JOIN refunds f ON f.payment_id = o.payment_id AND f.amount_paise = o.total_paise
		WHERE o.payment_id IS NOT NULL AND o.status IN ('declined', 'cancelled', 'expired', 'refunded')
		GROUP BY o.id HAVING count(f.id) <> 1`;
	expect([...owed]).toEqual([]);
	const wrongful = await sql`SELECT o.id, o.status FROM orders o JOIN refunds f ON f.payment_id = o.payment_id
		WHERE o.status IN ('paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed', 'received')`;
	expect([...wrongful]).toEqual([]);
	const unpaid = await sql`SELECT o.id FROM orders o
		WHERE o.payment_id IS NULL AND o.status IN ('paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed', 'received')`;
	expect([...unpaid]).toEqual([]);
	const stale = await sql`SELECT l.id FROM listings l WHERE (l.status = 'reserved') <> EXISTS (
		SELECT 1 FROM orders o WHERE o.listing_id = l.id
			AND o.status IN ('requested', 'paid', 'pickup_booked', 'in_transit', 'delivered', 'disputed'))`;
	expect([...stale]).toEqual([]);
}
