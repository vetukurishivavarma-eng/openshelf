// One test per finding in docs/security-report.md (SEC-) and docs/qa-report.md (QA-).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from '../src/lib/server/db';
import {
	acceptOrder, banUser, cancelOrder, cancelTestOrders, confirmReceived, courierEvent, createListing, createOrder,
	deleteAccount, disputeOrder, markHandedOver, orderFor, ordersThisMonth, resolveDispute, sweep
} from '../src/lib/server/engine';
import { bannedAccount, erasableUser, sessionUser, startSession, upsertGoogleUser, type SessionUser } from '../src/lib/server/auth';
import { flushRefunds, retryRefund } from '../src/lib/server/payments';
import { allow } from '../src/lib/server/ratelimit';
import { city } from '../src/lib/server/validate';
import { load as bookLoad } from '../src/routes/books/[id]/+page.server';
import { load as booksLoad } from '../src/routes/books/+page.server';
import { actions as adminActions, load as adminLoad } from '../src/routes/admin/+page.server';
import { actions as eraseActions } from '../src/routes/erase/+page.server';
import { load as ordersLoad } from '../src/routes/orders/+page.server';
import { actions as orderActions } from '../src/routes/orders/[id]/+page.server';
import {
	PICKUP, backdate, details, expectMoneyIntact, listingStatus, newListing, newUser, orderAt, pay, refundsFor, row, status
} from './helpers';

afterAll(expectMoneyIntact);

const SR = ['SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD', 'SHIPROCKET_WEBHOOK_TOKEN'];
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	for (const k of SR) delete process.env[k];
});

type Courier = { track?: string | Error; cancel?: Response | Error };
let calls: string[] = [];

/** A real-looking courier. `cancel` and `track` decide what the provider answers. */
function liveCourier({ track = 'AWB ASSIGNED', cancel = Response.json({}) }: Courier = {}) {
	calls = [];
	process.env.SHIPROCKET_EMAIL = 'e@x.test';
	process.env.SHIPROCKET_PASSWORD = 'p';
	vi.stubGlobal('fetch', async (url: string) => {
		const path = String(url).split('/external')[1];
		if (path === '/auth/login') return Response.json({ token: 't' });
		calls.push(path);
		if (path.startsWith('/courier/track')) {
			if (track instanceof Error) throw track;
			return Response.json({ tracking_data: { shipment_track: [{ current_status: track }] } });
		}
		if (path === '/orders/cancel') {
			if (cancel instanceof Error) throw cancel;
			return cancel.clone();
		}
		return Response.json({});
	});
}

async function booked(method: 'post' | 'in_transit' = 'post') {
	vi.unstubAllGlobals();
	for (const k of SR) delete process.env[k];
	const s = await orderAt(method === 'post' ? 'pickup_booked' : 'in_transit');
	await sql`UPDATE orders SET test_mode = false, shipment_id = ${`ship_${s.id}`}, courier_order_id = ${`co_${s.id}`} WHERE id = ${s.id}`;
	await sql`UPDATE refunds SET test_mode = false WHERE order_id = ${s.id}`;
	return s;
}

describe('SEC-H1 a booked courier is stopped before any refund', () => {
	it.each(['reader', 'giver'] as const)('delete is refused for the %s at pickup_booked and while moving', async (who) => {
		for (const at of ['pickup_booked', 'in_transit'] as const) {
			const s = await orderAt(at);
			await expect(deleteAccount(s[who])).rejects.toThrow('courier has a book');
			expect(await status(s.id)).toBe(at);
			expect((await refundsFor(s.id)).length).toBe(0);
			const [u] = await sql`SELECT deleted_at, email FROM users WHERE id = ${s[who]}`;
			expect(u.deleted_at).toBeNull();
			expect(u.email).not.toBeNull();
		}
	});

	it('a ban sends those orders to an admin, with no refund', async () => {
		for (const at of ['pickup_booked', 'in_transit'] as const) {
			const s = await orderAt(at);
			await banUser(s.reader);
			expect(await status(s.id)).toBe('disputed');
			expect((await refundsFor(s.id)).length).toBe(0);
		}
	});

	it('timeout: status is checked, the shipment cancelled, and only then a refund', async () => {
		const s = await booked();
		liveCourier();
		await backdate(s.id, '121 hours');
		await sweep();
		expect(calls.slice(0, 2)).toEqual([`/courier/track/shipment/ship_${s.id}`, '/orders/cancel']);
		expect(await status(s.id)).toBe('refunded');
		expect((await refundsFor(s.id)).length).toBe(1);
	});

	it('timeout: a book the courier says has moved goes to an admin, uncancelled and unrefunded', async () => {
		for (const track of ['PICKED UP', 'IN TRANSIT', 'Out For Delivery', 'DELIVERED']) {
			const s = await booked();
			liveCourier({ track });
			await backdate(s.id, '121 hours');
			await sweep();
			expect(calls).not.toContain('/orders/cancel');
			expect(await status(s.id)).toBe('disputed');
			expect((await refundsFor(s.id)).length).toBe(0);
		}
	});

	it('a failed cancellation means no refund', async () => {
		for (const cancel of [new Response('no', { status: 400 }), new Error('network')]) {
			const s = await booked();
			liveCourier({ cancel });
			await backdate(s.id, '121 hours');
			await sweep();
			expect(await status(s.id)).toBe('disputed');
			expect((await refundsFor(s.id)).length).toBe(0);
		}
	});

	it('a courier that cannot say where the book is means no refund', async () => {
		const s = await booked();
		liveCourier({ track: new Error('down') });
		await backdate(s.id, '121 hours');
		await sweep();
		expect(calls).not.toContain('/orders/cancel');
		expect(await status(s.id)).toBe('disputed');
	});

	it('a failure scan goes through the same stop', async () => {
		const s = await booked();
		liveCourier({ cancel: new Response('no', { status: 400 }) });
		await courierEvent(`ship_${s.id}`, 'failed');
		expect(await status(s.id)).toBe('disputed');
		expect((await refundsFor(s.id)).length).toBe(0);
	});

	it('a booking that fails before any shipment refunds without a cancel', async () => {
		const s = await orderAt('paid');
		await sql`UPDATE orders SET test_mode = false WHERE id = ${s.id}`;
		liveCourier();
		vi.stubGlobal('fetch', async () => new Response('no', { status: 500 }));
		await acceptOrder(s.giver, s.id, PICKUP);
		expect(await status(s.id)).toBe('refunded');
	});

	it('a booking stuck halfway goes to an admin', async () => {
		const s = await orderAt('paid');
		await sql`UPDATE orders SET test_mode = false WHERE id = ${s.id}`;
		liveCourier();
		vi.stubGlobal('fetch', async (url: string) => {
			if (String(url).includes('/auth/login')) return Response.json({ token: 't' });
			if (String(url).includes('orders/create')) return Response.json({ shipment_id: 1, order_id: 2 });
			if (String(url).includes('assign/awb') || String(url).includes('orders/cancel')) return new Response('no', { status: 500 });
			return Response.json({});
		});
		await acceptOrder(s.giver, s.id, PICKUP);
		expect(await status(s.id)).toBe('disputed');
		expect((await refundsFor(s.id)).length).toBe(0);
	});
});

describe('SEC-H2 test orders and the live world', () => {
	it('a test order never reaches the courier, whatever keys are set', async () => {
		const s = await orderAt('paid');
		liveCourier();
		await acceptOrder(s.giver, s.id, PICKUP);
		expect(calls).toEqual([]);
		expect((await row(s.id)).shipment_id).toMatch(/^test_ship_/);
	});

	it('open test orders are cancelled at live startup, without calling anyone', async () => {
		const [paid, moving, done] = [await orderAt('paid'), await orderAt('in_transit'), await orderAt('received')];
		const live = await orderAt('paid');
		await sql`UPDATE orders SET test_mode = false WHERE id = ${live.id}`;
		liveCourier();
		await cancelTestOrders();
		expect(calls).toEqual([]);
		expect(await status(paid.id)).toBe('cancelled');
		expect(await status(moving.id)).toBe('cancelled');
		expect(await listingStatus(paid.listing)).toBe('available');
		expect(await status(done.id)).toBe('received');
		expect(await status(live.id)).toBe('paid');
		await sql`UPDATE orders SET test_mode = true WHERE id = ${live.id}`;
	});
});

describe('SEC-M1 handover money', () => {
	it('after acceptance the reader cannot cancel; a dispute is the route', async () => {
		const s = await orderAt('pickup_booked', 'handover');
		await expect(cancelOrder(s.reader, s.id)).rejects.toThrow('Only the giver');
		expect((await refundsFor(s.id)).length).toBe(0);
		await disputeOrder(s.reader, s.id, 'Never showed up');
		expect(await status(s.id)).toBe('disputed');
	});

	it('the giver can cancel, with a full refund', async () => {
		const s = await orderAt('pickup_booked', 'handover');
		await cancelOrder(s.giver, s.id);
		expect((await refundsFor(s.id))[0].amount_paise).toBe(3900);
	});

	it('an accepted handover keeps counting towards the cap, even cancelled', async () => {
		const s = await orderAt('pickup_booked', 'handover');
		await cancelOrder(s.giver, s.id);
		expect(await ordersThisMonth(s.reader)).toBe(1);
	});

	it('a timed-out accepted handover goes to dispute, not a refund', async () => {
		const s = await orderAt('pickup_booked', 'handover');
		await backdate(s.id, '121 hours');
		await sweep();
		expect(await status(s.id)).toBe('disputed');
		expect((await refundsFor(s.id)).length).toBe(0);
	});

	it.each(['reader', 'giver'] as const)('closing the %s account cannot refund an agreed handover', async (who) => {
		const s = await orderAt('pickup_booked', 'handover');
		await deleteAccount(s[who]);
		expect(await status(s.id)).toBe('disputed');
		expect((await refundsFor(s.id)).length).toBe(0);
	});
});

describe('QA-M11 handover is for the same city', () => {
	it('is refused across cities, and offered only within one', async () => {
		const giver = await newUser('G', 'Pune');
		const far = await newUser('F', 'Kochi');
		const l = await newListing(giver);
		await expect(createOrder(far, l, details('handover'))).rejects.toThrow('Local handover');
		const page = (await (bookLoad as Function)({ params: { id: l }, locals: { user: { id: far, city: 'Kochi' } } }));
		expect(page.sameCity).toBe(false);
		const near = await (bookLoad as Function)({ params: { id: l }, locals: { user: { id: giver, city: 'Pune' } } });
		expect(near.sameCity).toBe(true);
	});

	it('city has one spelling, and cannot carry a phone number or link', () => {
		expect(city('  bangalore ')).toBe('Bengaluru');
		expect(city('NAVI   mumbai')).toBe('Navi Mumbai');
		expect(city('Bombay')).toBe('Mumbai');
		for (const bad of ['Call 9876543210', 'x.com/me', 'a', 'one two three four five', '<b>Pune</b>']) expect(city(bad)).toBeNull();
	});
});

describe('SEC-M2 the cap survives delete and return', () => {
	it('counts the same Google account across deletion', async () => {
		const sub = `cap-${randomUUID()}`;
		const first = (await upsertGoogleUser(sub, `${sub}@x.test`, 'R'))!;
		await sql`UPDATE users SET city = 'Pune', whatsapp = ${`+9180${Date.now() % 100000000}`} WHERE id = ${first}`;
		for (let i = 0; i < 3; i++) {
			const o = await createOrder(first, await newListing(await newUser()), details('post'));
			await pay(o.id);
			await sql`UPDATE orders SET status = 'received', status_at = now(), address = NULL, pickup_address = NULL, delivery_pincode = NULL, pickup_pincode = NULL WHERE id = ${o.id}`;
			await sql`UPDATE listings SET status = 'gone' WHERE id = ${o.listing_id}`;
		}
		await deleteAccount(first);
		const back = (await upsertGoogleUser(sub, `${sub}@x.test`, 'R'))!;
		expect(back).not.toBe(first);
		await sql`UPDATE users SET city = 'Pune', whatsapp = ${`+9181${Date.now() % 100000000}`} WHERE id = ${back}`;
		expect(await ordersThisMonth(back)).toBe(3);
		await expect(createOrder(back, await newListing(await newUser()), details('post'))).rejects.toThrow('limit of 3');
	});
});

describe('SEC-M4 failed refunds', () => {
	const failed = async () => {
		const s = await orderAt('paid');
		await declineAndFail(s.id, s.giver);
		return s;
	};
	const declineAndFail = async (id: string, giver: string) => {
		const { declineOrder } = await import('../src/lib/server/engine');
		await declineOrder(giver, id);
		await sql`UPDATE refunds SET status = 'failed', attempts = 10 WHERE order_id = ${id}`;
	};

	it('an admin can retry one, once, with the same refund row', async () => {
		const s = await failed();
		const [f] = await refundsFor(s.id);
		expect(await retryRefund(f.id)).toBe(true);
		expect((await refundsFor(s.id))[0]).toMatchObject({ id: f.id, status: 'sent' });
		expect(await retryRefund(f.id)).toBe(false);
	});

	it('the admin page lists it, and non-admins cannot retry', async () => {
		const s = await failed();
		const [f] = await refundsFor(s.id);
		const admin = { user: { id: await newUser(), isAdmin: true } };
		const page = await (adminLoad as Function)({ locals: admin });
		expect(page.refunds.map((r: { id: string }) => r.id)).toContain(f.id);
		const body = new FormData();
		body.set('id', f.id);
		const request = new Request('http://x', { method: 'POST', body });
		let code = 0;
		await (adminActions.retry as Function)({ request, locals: { user: { id: await newUser(), isAdmin: false } } }).catch((e: { status: number }) => (code = e.status));
		expect(code).toBe(404);
	});

	it('giving up raises an alert', async () => {
		const alert = vi.spyOn(console, 'error').mockImplementation(() => {});
		const s = await orderAt('paid');
		const { declineOrder } = await import('../src/lib/server/engine');
		await sql`UPDATE orders SET test_mode = false WHERE id = ${s.id}`;
		process.env.RAZORPAY_KEY_ID = 'k';
		process.env.RAZORPAY_KEY_SECRET = 's';
		process.env.RAZORPAY_WEBHOOK_SECRET = 'w';
		vi.stubGlobal('fetch', async () => new Response('no', { status: 500 }));
		try {
			await declineOrder(s.giver, s.id);
			for (let i = 0; i < 11; i++) await flushRefunds(s.id);
		} finally {
			for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) delete process.env[k];
		}
		expect(alert.mock.calls.some((c) => String(c[0]).startsWith('[alert] Refund failed'))).toBe(true);
		await sql`UPDATE refunds SET status = 'sent' WHERE order_id = ${s.id}`;
	});
});

describe('SEC-M5 rate limiter', () => {
	it('flooding one scope does not reset another or clear everyone', () => {
		const user = `request:${randomUUID()}`;
		expect(allow(user, 1, 0.001)).toBe(true);
		expect(allow(user, 1, 0.001)).toBe(false);
		const recent = `signin:${randomUUID()}`;
		allow(recent, 1, 0.001);
		for (let i = 0; i < 50_010; i++) {
			allow(`signin:flood-${i}`, 5, 5);
			if (i % 10_000 === 0) allow(recent, 1, 0.001);
		}
		expect(allow(user, 1, 0.001)).toBe(false);
		expect(allow(recent, 1, 0.001)).toBe(false);
	});
});

describe('SEC-M6 and QA-M4 erasure', () => {
	it('pincodes and dispute notes go at terminal states', async () => {
		const s = await orderAt('disputed');
		await resolveDispute(s.id, 'refunded');
		const o = await row(s.id);
		expect([o.delivery_pincode, o.pickup_pincode, o.dispute_note]).toEqual([null, null, null]);
	});

	it('the database refuses a pincode on a closed order', async () => {
		const s = await orderAt('received');
		await expect(sql`UPDATE orders SET delivery_pincode = '411001' WHERE id = ${s.id}`).rejects.toMatchObject({ code: '23514' });
	});

	it('deletion removes the text of reports the user made', async () => {
		const u = await newUser();
		const l = await newListing(await newUser());
		await sql`INSERT INTO reports (reporter_id, listing_id, reason) VALUES (${u}, ${l}, 'My neighbour Asha sells these')`;
		await deleteAccount(u);
		const [r] = await sql`SELECT reason FROM reports WHERE reporter_id = ${u}`;
		expect(r.reason).not.toContain('Asha');
	});

	it('a banned user can erase through a Google-proven token; a forged one cannot', async () => {
		const sub = `erase-${randomUUID()}`;
		const id = (await upsertGoogleUser(sub, `${sub}@x.test`, 'B'))!;
		await banUser(id);
		const token = await bannedAccount(sub);
		expect(erasableUser(token!)).toBe(id);
		expect(erasableUser(`${id}.${Date.now() + 9999}.deadbeef`)).toBeNull();
		expect(erasableUser(token!.replace(id, randomUUID()))).toBeNull();
		const body = new FormData();
		body.set('confirm', 'on');
		const cookies = { get: () => token, delete: () => {} };
		await (eraseActions.default as Function)({ request: new Request('http://x', { method: 'POST', body }), cookies }).catch(() => {});
		const [u] = await sql`SELECT email, banned_at, deleted_sub_hash FROM users WHERE id = ${id}`;
		expect(u.email).toBeNull();
		expect(u.banned_at).not.toBeNull();
		expect(await upsertGoogleUser(sub, `${sub}@x.test`, 'B')).toBeNull();
	});
});

describe('SEC-M7 reservation griefing and deadlines', () => {
	it('a reader cannot keep reserving without paying', async () => {
		const u = await newUser();
		for (let i = 0; i < 5; i++) {
			const o = await createOrder(u, await newListing(await newUser()), details('handover'));
			await cancelOrder(u, o.id);
		}
		await expect(createOrder(u, await newListing(await newUser()), details('handover'))).rejects.toThrow('without paying');
	});

	it('pay, accept and hand-over all recheck the deadline between sweeps', async () => {
		const unpaid = await orderAt('requested');
		await backdate(unpaid.id, '31 minutes');
		await pay(unpaid.id);
		expect(await status(unpaid.id)).toBe('requested');
		expect((await refundsFor(unpaid.id)).length).toBe(1);

		const paid = await orderAt('paid');
		await backdate(paid.id, '73 hours');
		await expect(acceptOrder(paid.giver, paid.id, PICKUP)).rejects.toThrow('72 hours');

		const hand = await orderAt('pickup_booked', 'handover');
		await backdate(hand.id, '121 hours');
		await expect(markHandedOver(hand.giver, hand.id)).rejects.toThrow('time');
		await sweep();
	});

	it('a dispute past the window is refused; confirming still ends the order', async () => {
		const s = await orderAt('delivered');
		await backdate(s.id, '337 hours');
		await expect(disputeOrder(s.reader, s.id, 'late')).rejects.toThrow('passed');
		await confirmReceived(s.reader, s.id);
		expect(await status(s.id)).toBe('received');
	});
});

describe('SEC-M8 pincode snapshot', () => {
	it('the courier is booked from the pincode that was quoted', async () => {
		const giver = await newUser();
		const reader = await newUser();
		const o = await createOrder(reader, await newListing(giver), details('post'));
		await pay(o.id);
		await sql`UPDATE orders SET test_mode = false WHERE id = ${o.id}`;
		await sql`UPDATE users SET pincode = '110001' WHERE id = ${giver}`;
		const bodies: Record<string, unknown>[] = [];
		liveCourier();
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			if (String(url).includes('/auth/login')) return Response.json({ token: 't' });
			if (String(url).includes('addpickup')) bodies.push(JSON.parse(String(init.body)));
			if (String(url).includes('orders/create')) return Response.json({ shipment_id: 5, order_id: 6 });
			return Response.json({});
		});
		await acceptOrder(giver, o.id, PICKUP);
		expect(bodies[0].pin_code).toBe('411001');
	});
});

describe('SEC-L5 ban after delete and return', () => {
	it('ends the live session of the returned account', async () => {
		const sub = `l5-${randomUUID()}`;
		const first = (await upsertGoogleUser(sub, `${sub}@x.test`, 'R'))!;
		await deleteAccount(first);
		const back = (await upsertGoogleUser(sub, `${sub}@x.test`, 'R'))!;
		const store = new Map<string, string>();
		const cookies = { get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v) };
		await startSession(cookies as never, back);
		expect(await sessionUser(cookies as never)).not.toBeNull();
		await banUser(first);
		expect(await sessionUser(cookies as never)).toBeNull();
	});
});

describe('SEC-L6 L7 and QA-L2 what shows when', () => {
	it('the giver name and note appear only after acceptance', async () => {
		const giver = await newUser('Zubeida Khan');
		const reader = await newUser();
		const id = await createListing(giver, { title: 'T', author: 'A', isbn: null, condition: 'good', note: 'For you' });
		const o = await createOrder(reader, id, details('post'));
		await pay(o.id);
		const before = (await orderFor(o.id, reader))!;
		expect([before.giver_name, before.note]).toEqual([null, null]);
		expect(JSON.stringify(before)).not.toContain('Zubeida');
		await acceptOrder(giver, o.id, PICKUP);
		const after = (await orderFor(o.id, reader))!;
		expect([after.giver_name, after.note]).toEqual(['Zubeida', 'For you']);
	});

	it('WhatsApp stops 7 days after a terminal state', async () => {
		const s = await orderAt('received');
		await backdate(s.id, '167 hours');
		expect((await orderFor(s.id, s.reader))!.whatsapp).toBeTruthy();
		await backdate(s.id, '169 hours');
		expect((await orderFor(s.id, s.reader))!.whatsapp).toBeNull();
		expect((await orderFor(s.id, s.giver))!.whatsapp).toBeNull();
	});
});

describe('QA-H1 and QA-H2 double submits', () => {
	it('the same order token returns the original order, in sequence and in parallel', async () => {
		const u = await newUser();
		const l = await newListing(await newUser());
		const token = randomUUID();
		const d = { ...details('post'), token };
		const all = await Promise.all([createOrder(u, l, d), createOrder(u, l, d), createOrder(u, l, d)]);
		expect(new Set(all.map((o) => o.id)).size).toBe(1);
		expect((await createOrder(u, l, d)).id).toBe(all[0].id);
		const rows = await sql`SELECT 1 FROM orders WHERE listing_id = ${l}`;
		expect(rows.length).toBe(1);
	});

	it('the same listing token makes one listing, in parallel', async () => {
		const u = await newUser();
		const b = { title: 'T', author: 'A', isbn: null, condition: 'good', note: null, token: randomUUID() } as const;
		const ids = await Promise.all([1, 2, 3, 4].map(() => createListing(u, b)));
		expect(new Set(ids).size).toBe(1);
		const rows = await sql`SELECT 1 FROM listings WHERE giver_id = ${u}`;
		expect(rows.length).toBe(1);
	});

	it('a repeated order action lands on the order, not an error', async () => {
		const s = await orderAt('delivered');
		const press = () => (orderActions.received as Function)({ params: { id: s.id }, locals: { user: { id: s.reader } } });
		const codes: [number, string][] = [];
		for (let i = 0; i < 2; i++) await press().catch((e: { status: number; location: string }) => codes.push([e.status, e.location]));
		expect(codes).toEqual([[303, `/orders/${s.id}`], [303, `/orders/${s.id}`]]);
	});
});

describe('QA-M5 M6 M7 M9 M10', () => {
	const told = () => vi.spyOn(console, 'log').mockImplementation(() => {});
	const settle = () => new Promise((r) => setTimeout(r, 50));

	it('M5: both parties hear when a moving book goes to dispute', async () => {
		for (const trigger of ['failure', 'timeout']) {
			const s = await orderAt('in_transit');
			const log = told();
			if (trigger === 'failure') await courierEvent((await row(s.id)).shipment_id, 'failed');
			else {
				await backdate(s.id, '505 hours');
				await sweep();
			}
			await settle();
			const lines = log.mock.calls.map((c) => String(c[0]));
			expect(lines.some((l) => l.includes(s.reader) && l.includes('reviewing'))).toBe(true);
			expect(lines.some((l) => l.includes(s.giver) && l.includes('reviewing'))).toBe(true);
			log.mockRestore();
		}
	});

	it('M6: cancelling an unpaid order tells the giver nothing and shows them nothing', async () => {
		const s = await orderAt('requested');
		const log = told();
		await cancelOrder(s.reader, s.id);
		await settle();
		expect(log.mock.calls.some((c) => String(c[0]).includes(s.giver))).toBe(false);
		log.mockRestore();
		const list = await (ordersLoad as Function)({ locals: { user: { id: s.giver } } });
		expect(list.orders).toEqual([]);
		const page = await import('../src/routes/orders/[id]/+page.server');
		let code = 0;
		await (page.load as Function)({ params: { id: s.id }, locals: { user: { id: s.giver } }, url: new URL('http://x') }).catch((e: { status: number }) => (code = e.status));
		expect(code).toBe(404);
	});

	it('M7: back on the book page, the reader finds their own order', async () => {
		const s = await orderAt('requested');
		const page = await (bookLoad as Function)({ params: { id: s.listing }, locals: { user: { id: s.reader, city: 'Pune' } } });
		expect(page.myOrderId).toBe(s.id);
	});

	it('M9: a banned giver’s in-order listing leaves public view but not the parties’', async () => {
		const s = await orderAt('in_transit');
		await banUser(s.giver);
		const load = (locals: unknown) => (bookLoad as Function)({ params: { id: s.listing }, locals });
		let code = 0;
		await load({ user: null }).catch((e: { status: number }) => (code = e.status));
		expect(code).toBe(404);
		code = 0;
		await load({ user: { id: await newUser(), city: 'Pune' } }).catch((e: { status: number }) => (code = e.status));
		expect(code).toBe(404);
		expect((await load({ user: { id: s.reader, city: 'Pune' } })).myOrderId).toBe(s.id);
		expect((await load({ user: { id: s.giver, city: 'Pune' } })).book.mine).toBe(true);
	});

	it('M10: the order remembers which step a dispute came from', async () => {
		const s = await orderAt('in_transit');
		await disputeOrder(s.reader, s.id, 'Lost');
		expect((await orderFor(s.id, s.reader))!.disputed_from).toBe('in_transit');
	});
});

describe('QA-M3 and QA-L8', () => {
	it('Hindi, Telugu and emoji survive', async () => {
		const u = await newUser();
		const id = await createListing(u, { title: 'गोदान తెలుగు 📚', author: 'प्रेमचंद', isbn: null, condition: 'good', note: 'पढ़िए' });
		const [l] = await sql`SELECT title, note FROM listings WHERE id = ${id}`;
		expect([l.title, l.note]).toEqual(['गोदान తెలుగు 📚', 'पढ़िए']);
	});

	it('a very long search is shortened, not ignored', async () => {
		const u = await newUser();
		const [l] = await sql`INSERT INTO listings (giver_id, title, author, condition)
			VALUES (${u}, 'Unique Yarn', 'A', 'good') RETURNING id`;
		const page = await (booksLoad as Function)({ url: new URL(`http://x/books?q=${'nosuchword'.repeat(20)}`) });
		expect(page.filters.q).toHaveLength(100);
		expect(page.books.map((b: { id: string }) => b.id)).not.toContain(l.id);
	});
});

beforeEach(() => void (calls = []));
export type { SessionUser };
