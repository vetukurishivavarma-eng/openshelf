// One courier, Shiprocket-shaped. Without keys it is a labelled test mode: nothing is booked.
const API = 'https://apiv2.shiprocket.in/v1/external';
const WEIGHT_KG = 0.5; // ponytail: flat parcel size; ask the giver for weight when thick books misquote.
const DIMENSION_CM = 25;
// Any of these means the book has left the giver.
export const MOVED = /PICKED UP|IN TRANSIT|OUT FOR DELIVERY|SHIPPED|DELIVERED/;

export const courierTestMode = () => !(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);

/** The courier accepted part of a booking and it could not be undone. A person must look. */
export class CourierStuck extends Error {}

let token: { value: string; expires: number } | null = null;

async function call(path: string, init?: RequestInit) {
	if (!token || token.expires < Date.now()) {
		const res = await fetch(`${API}/auth/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }),
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) throw new Error(`Shiprocket login ${res.status}`);
		token = { value: (await res.json()).token, expires: Date.now() + 8 * 24 * 3_600_000 };
	}
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json' },
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Shiprocket ${path} ${res.status}`);
	return res.json();
}

/** Cheapest prepaid rate in integer paise, or null when no courier serves the route. */
export async function quoteCourier(from: string, to: string): Promise<number | null> {
	if (courierTestMode()) return from[0] === to[0] ? 5900 : 8900;
	const q = new URLSearchParams({
		pickup_postcode: from,
		delivery_postcode: to,
		weight: String(WEIGHT_KG),
		cod: '0'
	});
	const data = await call(`/courier/serviceability/?${q}`);
	const rates: number[] = (data.data?.available_courier_companies ?? []).map((c: { rate: number }) => Number(c.rate));
	const best = rates.filter((r) => r > 0).sort((a, b) => a - b)[0];
	return best ? Math.ceil(best * 100) : null;
}

export type Pickup = {
	orderId: string;
	title: string;
	giver: { name: string; phone: string; address: string; city: string; pincode: string };
	reader: { name: string; phone: string; address: string; city: string; pincode: string };
};

/** True when the courier says the book has left. Throws if the courier cannot say. */
export async function shipmentMoved(shipmentId: string) {
	const data = await call(`/courier/track/shipment/${shipmentId}`);
	const track = data.tracking_data?.shipment_track?.[0];
	return MOVED.test(String(track?.current_status ?? '').toUpperCase());
}

/** Throws unless the courier confirms. A caller must not refund after a throw. */
export async function cancelShipment(courierOrderId: string) {
	await call('/orders/cancel', { method: 'POST', body: JSON.stringify({ ids: [courierOrderId] }) });
}

/** A test order never reaches the courier, whatever keys are set by the time it is accepted. */
export async function bookPickup(p: Pickup, testOrder: boolean) {
	if (testOrder || courierTestMode())
		return { shipmentId: `test_ship_${p.orderId}`, courierOrderId: `test_courier_${p.orderId}` };

	const location = `giver-${p.orderId}`.slice(0, 36);
	await call('/settings/company/addpickup', {
		method: 'POST',
		body: JSON.stringify({
			pickup_location: location,
			name: p.giver.name,
			email: process.env.SHIPROCKET_EMAIL,
			phone: p.giver.phone.slice(3),
			address: p.giver.address,
			city: p.giver.city,
			state: p.giver.city,
			country: 'India',
			pin_code: p.giver.pincode
		})
	});
	const order = await call('/orders/create/adhoc', {
		method: 'POST',
		body: JSON.stringify({
			order_id: p.orderId,
			order_date: new Date().toISOString().slice(0, 16).replace('T', ' '),
			pickup_location: location,
			billing_customer_name: p.reader.name,
			billing_last_name: '',
			billing_address: p.reader.address,
			billing_city: p.reader.city,
			billing_pincode: p.reader.pincode,
			billing_state: p.reader.city,
			billing_country: 'India',
			billing_email: process.env.SHIPROCKET_EMAIL,
			billing_phone: p.reader.phone.slice(3),
			shipping_is_billing: true,
			order_items: [{ name: p.title.slice(0, 100), sku: p.orderId, units: 1, selling_price: 0 }],
			payment_method: 'Prepaid',
			sub_total: 0,
			length: DIMENSION_CM,
			breadth: DIMENSION_CM,
			height: 5,
			weight: WEIGHT_KG
		})
	});
	const shipmentId = String(order.shipment_id);
	const courierOrderId = String(order.order_id);
	try {
		await call('/courier/assign/awb', { method: 'POST', body: JSON.stringify({ shipment_id: shipmentId }) });
		await call('/courier/generate/pickup', { method: 'POST', body: JSON.stringify({ shipment_id: [shipmentId] }) });
	} catch (e) {
		// A half-made booking must be undone before a refund is safe.
		await cancelShipment(courierOrderId).catch(() => {
			throw new CourierStuck(`Booking ${courierOrderId} failed halfway: ${e}`);
		});
		throw e;
	}
	return { shipmentId, courierOrderId };
}
