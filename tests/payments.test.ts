import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/lib/server/db';
import {
	acceptOrder, cancelOrder, createOrder, declineOrder, sweep
} from '../src/lib/server/engine';
import { bookPickup, courierTestMode, quoteCourier } from '../src/lib/server/courier';
import { assertConfig, flushRefunds, handleWebhook, paymentsTestMode } from '../src/lib/server/payments';
import { POST as razorpayRoute } from '../src/routes/webhooks/razorpay/+server';
import { POST as courierRoute } from '../src/routes/webhooks/courier/+server';
import {
	PICKUP, backdate, details, expectMoneyIntact, listingStatus, newListing, newUser, orderAt, refundsFor, row, status
} from './helpers';

const SECRET = 'whsec_test_only';
const KEYS = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD', 'ALLOW_TEST_PAYMENTS', 'SUB_HASH_SALT', 'SHIPROCKET_WEBHOOK_TOKEN'];

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };
let calls: Call[] = [];
let refundResponse: () => Response;

function goLive() {
	process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
	process.env.RAZORPAY_KEY_SECRET = 'secret';
	process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
	refundResponse = () => Response.json({ id: `rfnd_${randomUUID()}` });
	vi.stubGlobal('fetch', async (url: string, init: Call['init']) => {
		calls.push({ url: String(url), init });
		if (String(url).endsWith('/orders')) return Response.json({ id: `order_${randomUUID()}` });
		if (String(url).includes('/refund')) return refundResponse();
		throw new Error(`unexpected fetch ${url}`);
	});
}

beforeEach(() => void (calls = []));
afterEach(() => {
	vi.unstubAllGlobals();
	for (const k of KEYS) delete process.env[k];
});
afterAll(expectMoneyIntact);

const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');
const refundCalls = () => calls.filter((c) => c.url.includes('/refund'));

function captured(gatewayOrderId: string, amount: number, paymentId = `pay_${randomUUID()}`, event = 'payment.captured', currency = 'INR') {
	return JSON.stringify({
		event,
		payload: { payment: { entity: { id: paymentId, order_id: gatewayOrderId, amount, currency } } }
	});
}

const deliver = (raw: string, eventId: string = randomUUID()) => handleWebhook(raw, sign(raw), eventId);

async function liveOrder(method: 'post' | 'handover' = 'handover') {
	const owner = await newUser();
	const requester = await newUser();
	const listing = await newListing(owner);
	const o = await createOrder(requester, listing, details(method));
	return { owner, requester, listing, id: o.id, gateway: o.gateway_order_id!, total: o.total_paise };
}

describe('webhook authenticity', () => {
	beforeEach(goLive);

	it('a valid event confirms the order and the row keeps the verified payment', async () => {
		const o = await liveOrder();
		expect(await deliver(captured(o.gateway, o.total, 'pay_good'))).toBe(200);
		const r = await row(o.id);
		expect([r.status, r.payment_id, r.test_mode]).toEqual(['paid', 'pay_good', false]);
	});

	it('refuses a forged signature, one for other bytes, a missing one, and no event id', async () => {
		const o = await liveOrder();
		const raw = captured(o.gateway, o.total);
		expect(await handleWebhook(raw, sign(raw, 'wrong-secret'), 'e1')).toBe(400);
		expect(await handleWebhook(raw, sign(`${raw} `), 'e2')).toBe(400);
		expect(await handleWebhook(raw, 'abc', 'e3')).toBe(400);
		expect(await handleWebhook(raw, null, 'e4')).toBe(400);
		expect(await handleWebhook(raw, sign(raw), null)).toBe(400);
		expect(await status(o.id)).toBe('requested');
		const seen = await sql`SELECT 1 FROM webhook_events WHERE event_id IN ('e1', 'e2', 'e3', 'e4')`;
		expect(seen.length).toBe(0);
	});

	it('verifies the raw bytes through the route, so reformatted JSON fails', async () => {
		const o = await liveOrder();
		const raw = captured(o.gateway, o.total);
		const post = (body: string, signature: string) =>
			(razorpayRoute as Function)({
				request: new Request('http://x/webhooks/razorpay', {
					method: 'POST',
					headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': randomUUID() },
					body
				})
			});
		expect((await post(JSON.stringify(JSON.parse(raw), null, 2), sign(raw))).status).toBe(400);
		expect(await status(o.id)).toBe('requested');
		expect((await post(raw, sign(raw))).status).toBe(200);
		expect(await status(o.id)).toBe('paid');
	});

	it('a signed event that is not JSON is refused, not crashed on', async () => {
		expect(await deliver('not json')).toBe(400);
	});
});

describe('webhook idempotency', () => {
	beforeEach(goLive);

	it('a replay changes nothing', async () => {
		const o = await liveOrder();
		const raw = captured(o.gateway, o.total);
		const id = randomUUID();
		await deliver(raw, id);
		const first = await row(o.id);
		expect(await deliver(raw, id)).toBe(200);
		expect(await row(o.id)).toEqual(first);
		const events = await sql`SELECT 1 FROM webhook_events WHERE event_id = ${id}`;
		expect(events.length).toBe(1);
	});

	it('a replay of a late payment refunds once', async () => {
		const o = await liveOrder();
		await cancelOrder(o.requester, o.id);
		const raw = captured(o.gateway, o.total);
		const id = randomUUID();
		await deliver(raw, id);
		await deliver(raw, id);
		await deliver(raw); // Same payment under a new event id.
		expect(refundCalls().length).toBe(1);
	});

	it('payment.captured then order.paid for one payment is one payment', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total, 'pay_same'));
		await deliver(captured(o.gateway, o.total, 'pay_same', 'order.paid'));
		expect(await status(o.id)).toBe('paid');
		expect((await refundsFor(o.id)).length).toBe(0);
	});
});

describe('amount verification', () => {
	beforeEach(goLive);

	it('the wrong amount does not confirm, and goes back', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total - 100));
		expect(await status(o.id)).toBe('requested');
		const [f] = await refundsFor(o.id);
		expect([f.amount_paise, f.reason]).toEqual([o.total - 100, 'wrong amount']);
		expect(refundCalls().length).toBe(1);
		expect(JSON.parse(refundCalls()[0].init.body as string).amount).toBe(o.total - 100);
	});

	it('too much, and the wrong currency, are refused too', async () => {
		const a = await liveOrder();
		await deliver(captured(a.gateway, a.total + 1));
		expect(await status(a.id)).toBe('requested');
		const b = await liveOrder();
		await deliver(captured(b.gateway, b.total, undefined, 'payment.captured', 'USD'));
		expect(await status(b.id)).toBe('requested');
	});

	it('the right payment can still follow a wrong one', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, 1));
		await deliver(captured(o.gateway, o.total));
		expect(await status(o.id)).toBe('paid');
	});

	it('Razorpay is asked for the server price', async () => {
		const o = await liveOrder('post');
		const create = calls.find((c) => c.url.endsWith('/orders'))!;
		expect(JSON.parse(create.init.body as string)).toMatchObject({ amount: o.total, currency: 'INR' });
		expect(o.total).toBe(12800);
	});
});

describe('out-of-order events', () => {
	beforeEach(goLive);

	it('payment after the order expired refunds automatically', async () => {
		const o = await liveOrder();
		await backdate(o.id, '31 minutes');
		await sweep();
		expect(await status(o.id)).toBe('expired');
		expect(await listingStatus(o.listing)).toBe('available');
		await deliver(captured(o.gateway, o.total, 'pay_late'));
		expect(await status(o.id)).toBe('expired');
		const [f] = await refundsFor(o.id);
		expect([f.payment_id, f.amount_paise, f.status]).toEqual(['pay_late', o.total, 'sent']);
	});

	it('a second payment on a paid order refunds only the second', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total, 'pay_a'));
		await deliver(captured(o.gateway, o.total, 'pay_b'));
		expect(await status(o.id)).toBe('paid');
		expect((await refundsFor(o.id)).map((f) => f.payment_id)).toEqual(['pay_b']);
	});

	it('payment.failed is ignored, and an unknown order is acknowledged without effect', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total));
		await deliver(captured(o.gateway, o.total, 'pay_x', 'payment.failed'));
		expect(await status(o.id)).toBe('paid');
		expect(await deliver(captured('order_unknown', 100))).toBe(200);
	});

	it('refund.processed overtaking the API response is not downgraded', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total, 'pay_race'));
		const processed = JSON.stringify({
			event: 'refund.processed',
			payload: { refund: { entity: { id: 'rfnd_x', payment_id: 'pay_race' } } }
		});
		refundResponse = () => Response.json({ id: 'rfnd_x' });
		const slow = refundResponse;
		const fetchRefund = async () => {
			await deliver(processed); // Arrives while the refund call is in flight.
			return slow();
		};
		refundResponse = () => {
			throw new Error('replaced below');
		};
		vi.stubGlobal('fetch', async () => fetchRefund());
		await declineOrder(o.owner, o.id);
		expect((await refundsFor(o.id))[0].status).toBe('processed');
	});

	it('refund.failed surfaces for an admin; refund.processed afterwards settles it', async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total, 'pay_f'));
		await declineOrder(o.owner, o.id);
		const event = (kind: string) =>
			JSON.stringify({ event: kind, payload: { refund: { entity: { id: 'r', payment_id: 'pay_f' } } } });
		await deliver(event('refund.failed'));
		expect((await refundsFor(o.id))[0].status).toBe('failed');
		await deliver(event('refund.processed'));
		await deliver(event('refund.failed'));
		expect((await refundsFor(o.id))[0].status).toBe('processed');
	});
});

describe('refund delivery', () => {
	beforeEach(goLive);

	const paid = async () => {
		const o = await liveOrder();
		await deliver(captured(o.gateway, o.total, `pay_${randomUUID()}`));
		return o;
	};

	it('sends the full amount with an idempotency key', async () => {
		const o = await paid();
		await declineOrder(o.owner, o.id);
		const [c] = refundCalls();
		const r = await row(o.id);
		expect(c.url).toContain(`/payments/${r.payment_id}/refund`);
		expect(JSON.parse(c.init.body as string).amount).toBe(o.total);
		expect(c.init.headers['X-Refund-Idempotency']).toBe((await refundsFor(o.id))[0].id);
	});

	it('parallel flushes reach the provider once', async () => {
		const o = await paid();
		await sql`INSERT INTO refunds (order_id, payment_id, amount_paise, reason, test_mode)
			VALUES (${o.id}, 'pay_parallel', 100, 'test', false)`;
		await Promise.all(Array.from({ length: 8 }, () => flushRefunds(o.id)));
		expect(refundCalls().filter((c) => c.url.includes('pay_parallel')).length).toBe(1);
	});

	it('a provider failure stays queued, and sweep retries with the same key', async () => {
		const o = await paid();
		refundResponse = () => new Response('nope', { status: 500 });
		await declineOrder(o.owner, o.id);
		expect((await refundsFor(o.id))[0].status).toBe('pending');
		refundResponse = () => Response.json({ id: 'rfnd_ok' });
		await sweep();
		const [f] = await refundsFor(o.id);
		expect([f.status, f.provider_refund_id, f.attempts]).toEqual(['sent', 'rfnd_ok', 2]);
		const keys = new Set(refundCalls().map((c) => c.init.headers['X-Refund-Idempotency']));
		expect(keys.size).toBe(1);
		await sweep();
		expect(refundCalls().filter((c) => c.init.headers['X-Refund-Idempotency'] === f.id).length).toBe(2);
	});

	it('a refund stuck by a crash is retried only after the delay', async () => {
		const o = await paid();
		refundResponse = () => new Response('nope', { status: 500 });
		await declineOrder(o.owner, o.id);
		const before = refundCalls().length;
		await sql`UPDATE refunds SET status = 'processing', attempted_at = now() WHERE order_id = ${o.id}`;
		await flushRefunds(o.id);
		expect(refundCalls().length).toBe(before);
		refundResponse = () => Response.json({ id: 'rfnd_late' });
		await sql`UPDATE refunds SET attempted_at = now() - interval '16 minutes' WHERE order_id = ${o.id}`;
		await flushRefunds(o.id);
		expect((await refundsFor(o.id))[0].status).toBe('sent');
	});

	it('gives up after 10 attempts, visibly', async () => {
		const o = await paid();
		refundResponse = () => new Response('nope', { status: 500 });
		await declineOrder(o.owner, o.id);
		for (let i = 0; i < 12; i++) await flushRefunds(o.id);
		const [f] = await refundsFor(o.id);
		expect([f.status, f.attempts]).toEqual(['failed', 10]);
	});

	it('a test-mode order never reaches Razorpay, even after keys appear', async () => {
		vi.unstubAllGlobals();
		delete process.env.RAZORPAY_KEY_ID;
		const s = await orderAt('paid');
		goLive();
		await declineOrder(s.owner, s.id);
		expect(refundCalls().length).toBe(0);
		expect((await refundsFor(s.id))[0].provider_refund_id).toMatch(/^test_rfnd_/);
	});
});

describe('gateway failure', () => {
	it('releases the book and reports plainly', async () => {
		goLive();
		vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
		const listing = await newListing(await newUser());
		const u = await newUser();
		await expect(createOrder(u, listing, details('handover'))).rejects.toThrow('Payments are unavailable');
		expect(await listingStatus(listing)).toBe('available');
	});
});

describe('test mode', () => {
	it('is on without keys, and off only with all of them', () => {
		expect(paymentsTestMode()).toBe(true);
		process.env.RAZORPAY_KEY_ID = 'k';
		expect(paymentsTestMode()).toBe(true);
		goLive();
		expect(paymentsTestMode()).toBe(false);
	});

	it('production refuses to start in test mode', () => {
		process.env.SUB_HASH_SALT = 's';
		expect(() => assertConfig(true)).toThrow('Refusing to start in test mode');
		goLive();
		expect(() => assertConfig(true)).toThrow('Refusing to start in test mode'); // Courier still test.
		process.env.SHIPROCKET_EMAIL = 'e';
		process.env.SHIPROCKET_PASSWORD = 'p';
		expect(() => assertConfig(true)).not.toThrow();
	});

	it('ALLOW_TEST_PAYMENTS=1 is the only override, and development is exempt', () => {
		process.env.SUB_HASH_SALT = 's';
		process.env.ALLOW_TEST_PAYMENTS = 'true';
		expect(() => assertConfig(true)).toThrow();
		process.env.ALLOW_TEST_PAYMENTS = '1';
		expect(() => assertConfig(true)).not.toThrow();
		delete process.env.ALLOW_TEST_PAYMENTS;
		expect(() => assertConfig(false)).not.toThrow();
	});

	it('half-set keys are refused everywhere; production needs the salt', () => {
		process.env.RAZORPAY_KEY_ID = 'k';
		expect(() => assertConfig(false)).toThrow('or none');
		delete process.env.RAZORPAY_KEY_ID;
		process.env.ALLOW_TEST_PAYMENTS = '1';
		expect(() => assertConfig(true)).toThrow('SUB_HASH_SALT');
	});

	it('a webhook cannot be forged with a guessable test secret', async () => {
		const s = await orderAt('requested');
		const o = await row(s.id);
		const raw = captured(o.gateway_order_id, o.total_paise);
		for (const secret of ['', 'test', 'test-webhook-secret', SECRET])
			expect(await handleWebhook(raw, sign(raw, secret), randomUUID())).toBe(400);
		expect(await status(s.id)).toBe('requested');
	});

	it('the test courier books nothing and quotes deterministically', async () => {
		expect(courierTestMode()).toBe(true);
		expect(await quoteCourier('411001', '400001')).toBe(5900);
		expect(await quoteCourier('411001', '560001')).toBe(8900);
	});
});

describe('courier, Shiprocket shape', () => {
	const live = (routes: Record<string, unknown>) => {
		process.env.SHIPROCKET_EMAIL = 'e@x.test';
		process.env.SHIPROCKET_PASSWORD = 'p';
		const seen: string[] = [];
		vi.stubGlobal('fetch', async (url: string) => {
			seen.push(String(url));
			const key = Object.keys(routes).find((k) => String(url).includes(k));
			if (String(url).includes('/auth/login')) return Response.json({ token: 'tok' });
			if (!key) return new Response('no', { status: 500 });
			return Response.json(routes[key]);
		});
		return seen;
	};

	it('quotes the cheapest rate, rounded up to whole paise', async () => {
		live({ serviceability: { data: { available_courier_companies: [{ rate: 120.5 }, { rate: 64.333 }] } } });
		expect(await quoteCourier('411001', '560001')).toBe(6434);
	});

	it('returns null when no courier serves the route, which refuses the order', async () => {
		live({ serviceability: { data: { available_courier_companies: [] } } });
		expect(await quoteCourier('411001', '560001')).toBeNull();
		const u = await newUser();
		const l = await newListing(await newUser());
		await expect(createOrder(u, l, details('post'))).rejects.toThrow('No courier');
		expect(await listingStatus(l)).toBe('available');
	});

	it('books in order: pickup location, order, AWB, pickup', async () => {
		const seen = live({ addpickup: {}, 'orders/create': { shipment_id: 77 }, 'assign/awb': {}, 'generate/pickup': {} });
		const person = { name: 'N', phone: '+919000000000', address: 'A', city: 'C', pincode: '411001' };
		expect(await bookPickup({ orderId: 'o1', title: 'T', giver: person, reader: person })).toBe('77');
		expect(seen.filter((u) => !u.includes('login')).map((u) => u.split('/external')[1])).toEqual([
			'/settings/company/addpickup', '/orders/create/adhoc', '/courier/assign/awb', '/courier/generate/pickup'
		]);
	});

	it('a booking failure is a pickup failure: refunded in full', async () => {
		const s = await orderAt('paid');
		live({});
		await acceptOrder(s.owner, s.id, PICKUP);
		expect(await status(s.id)).toBe('refunded');
		expect((await refundsFor(s.id)).length).toBe(1);
		expect(await listingStatus(s.listing)).toBe('available');
	});
});

describe('courier webhook', () => {
	const post = (body: object, token?: string) =>
		(courierRoute as Function)({
			request: new Request('http://x/webhooks/courier', {
				method: 'POST',
				headers: token ? { 'x-api-key': token } : {},
				body: JSON.stringify(body)
			})
		});

	it('refuses a missing or wrong token, and everything when no token is set', async () => {
		const s = await orderAt('pickup_booked');
		const shipment = (await row(s.id)).shipment_id;
		expect((await post({ shipment_id: shipment, current_status: 'DELIVERED' }, 'x')).status).toBe(401);
		process.env.SHIPROCKET_WEBHOOK_TOKEN = 'tok';
		expect((await post({ shipment_id: shipment, current_status: 'DELIVERED' })).status).toBe(401);
		expect((await post({ shipment_id: shipment, current_status: 'DELIVERED' }, 'bad')).status).toBe(401);
		expect(await status(s.id)).toBe('pickup_booked');
	});

	it('maps scans, tolerates repeats and out-of-order delivery', async () => {
		process.env.SHIPROCKET_WEBHOOK_TOKEN = 'tok';
		const s = await orderAt('pickup_booked');
		const shipment = (await row(s.id)).shipment_id;
		await post({ shipment_id: shipment, current_status: 'Picked Up' }, 'tok');
		expect(await status(s.id)).toBe('in_transit');
		await post({ shipment_id: shipment, current_status: 'Picked Up' }, 'tok');
		await post({ shipment_id: shipment, current_status: 'Delivered' }, 'tok');
		expect(await status(s.id)).toBe('delivered');
		await post({ shipment_id: shipment, current_status: 'IN TRANSIT' }, 'tok');
		expect(await status(s.id)).toBe('delivered');
	});

	it('a pickup exception refunds; an unknown shipment is acknowledged', async () => {
		process.env.SHIPROCKET_WEBHOOK_TOKEN = 'tok';
		const s = await orderAt('pickup_booked');
		await post({ shipment_id: (await row(s.id)).shipment_id, current_status: 'PICKUP EXCEPTION' }, 'tok');
		expect(await status(s.id)).toBe('refunded');
		expect((await post({ shipment_id: 'nope', current_status: 'DELIVERED' }, 'tok')).status).toBe(200);
	});
});
