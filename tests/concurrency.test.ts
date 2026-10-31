import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { sql, type Tx } from '../src/lib/server/db';
import {
	OrderError, acceptOrder, banUser, cancelOrder, confirmReceived, courierEvent, createListing, createOrder,
	declineOrder, disputeOrder, giveOnward, ordersThisMonth, pickupFailed, resolveDispute, sendThanks, sweep
} from '../src/lib/server/engine';
import { handleWebhook } from '../src/lib/server/payments';
import {
	PICKUP, backdate, details, expectMoneyIntact, listingStatus, newListing, newUser, orderAt, pay, refundsFor, row, status
} from './helpers';

afterAll(expectMoneyIntact);
afterEach(() => {
	vi.unstubAllGlobals();
	for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) delete process.env[k];
});

const ROUNDS = 8;

/**
 * Holds a row lock, starts each contender only once the previous one is blocked (Postgres reports
 * it waiting on a lock), then releases. This proves real overlap, and lock queues are FIFO, so
 * contenders reach the row in array order.
 */
async function race(lock: (t: Tx) => Promise<unknown>, fns: (() => Promise<unknown>)[]) {
	const pending: Promise<unknown>[] = [];
	await sql.begin(async (t) => {
		await lock(t);
		for (const [started, fn] of fns.entries()) {
			pending.push(fn());
			for (let i = 0; ; i++) {
				const [{ n }] = await sql`SELECT count(*)::int AS n FROM pg_stat_activity
					WHERE datname = current_database() AND wait_event_type = 'Lock'`;
				if (n > started) break;
				if (i > 800) throw new Error(`only ${n} of ${started + 1} contenders blocked`);
				await new Promise((r) => setTimeout(r, 5));
			}
		}
	});
	const results = await Promise.allSettled(pending);
	for (const r of results)
		if (r.status === 'rejected' && !(r.reason instanceof OrderError)) throw r.reason;
	return results;
}

const wins = (r: PromiseSettledResult<unknown>[]) => r.filter((x) => x.status === 'fulfilled').length;
const lockListing = (id: string) => (t: Tx) => t`SELECT 1 FROM listings WHERE id = ${id} FOR UPDATE`;
const lockUser = (id: string) => (t: Tx) => t`SELECT 1 FROM users WHERE id = ${id} FOR UPDATE`;
const lockOrder = (id: string) => (t: Tx) => t`SELECT 1 FROM orders WHERE id = ${id} FOR UPDATE`;

describe('buyers', () => {
	it('two buyers, one listing: one wins', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const listing = await newListing(await newUser());
			const a = await newUser();
			const b = await newUser();
			const r = await race(lockListing(listing), [
				() => createOrder(a, listing, details('post')),
				() => createOrder(b, listing, details('post'))
			]);
			expect(wins(r)).toBe(1);
			expect(await listingStatus(listing)).toBe('reserved');
			const [{ n }] = await sql`SELECT count(*)::int AS n FROM orders WHERE listing_id = ${listing}`;
			expect(n).toBe(1);
		}
	});

	it('eight buyers, one listing: one wins', async () => {
		const listing = await newListing(await newUser());
		const users = await Promise.all(Array.from({ length: 8 }, () => newUser()));
		const r = await race(lockListing(listing), users.map((u) => () => createOrder(u, listing, details('handover'))));
		expect(wins(r)).toBe(1);
	});

	it('monthly cap: the last slot goes to one of many parallel requests', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const u = await newUser();
			for (let k = 0; k < 2; k++) await createOrder(u, await newListing(await newUser()), details('handover'));
			const listings = await Promise.all([1, 2, 3, 4].map(async () => newListing(await newUser())));
			const r = await race(lockUser(u), listings.map((l) => () => createOrder(u, l, details('handover'))));
			expect(wins(r)).toBe(1);
			expect(await ordersThisMonth(u)).toBe(3);
			const free = await Promise.all(listings.map(listingStatus));
			expect(free.filter((s) => s === 'available').length).toBe(3);
		}
	});

	it('monthly cap: eight parallel from zero gives exactly three', async () => {
		const u = await newUser();
		const listings = await Promise.all(Array.from({ length: 8 }, async () => newListing(await newUser())));
		const r = await race(lockUser(u), listings.map((l) => () => createOrder(u, l, details('handover'))));
		expect(wins(r)).toBe(3);
	});

	it('ban racing an order on their listing leaves nothing stranded', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const giver = await newUser();
			const listing = await newListing(giver);
			const u = await newUser();
			await Promise.allSettled([createOrder(u, listing, details('post')), banUser(giver)]);
			expect(await listingStatus(listing)).toBe('removed');
			const open = await sql`SELECT 1 FROM orders WHERE listing_id = ${listing} AND status = 'requested'`;
			expect(open.length).toBe(0);
		}
	});
});

describe('transitions', () => {
	it('concurrent confirm and dispute: exactly one wins', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('delivered');
			const r = await race(lockOrder(s.id), [
				() => confirmReceived(s.reader, s.id),
				() => disputeOrder(s.reader, s.id, 'never came')
			]);
			expect(wins(r)).toBe(1);
			expect(await status(s.id)).toBe('received');
		}
	});

	it('dispute first wins the other way', async () => {
		const s = await orderAt('delivered');
		await race(lockOrder(s.id), [
			() => disputeOrder(s.reader, s.id, 'never came'),
			() => confirmReceived(s.reader, s.id)
		]);
		expect(await status(s.id)).toBe('disputed');
	});

	it('sweep racing accept: accept first wins, sweep refunds nothing', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('paid');
			await backdate(s.id, '73 hours');
			const [accept] = await race(lockOrder(s.id), [() => acceptOrder(s.giver, s.id, PICKUP), () => sweep()]);
			expect(accept.status).toBe('fulfilled');
			expect(await status(s.id)).toBe('pickup_booked');
			expect((await refundsFor(s.id)).length).toBe(0);
		}
	});

	it('sweep racing accept: sweep first wins, accept is refused, one refund', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('paid');
			await backdate(s.id, '73 hours');
			const [, accept] = await race(lockOrder(s.id), [() => sweep(), () => acceptOrder(s.giver, s.id, PICKUP)]);
			expect(accept.status).toBe('rejected');
			expect(await status(s.id)).toBe('expired');
			expect((await refundsFor(s.id)).length).toBe(1);
			expect(await listingStatus(s.listing)).toBe('available');
		}
	});

	it('sweep racing confirm on a due order: one stop on the journey', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('delivered');
			await backdate(s.id, '337 hours');
			await race(lockOrder(s.id), [() => confirmReceived(s.reader, s.id), () => sweep()]);
			expect(await status(s.id)).toBe('received');
			const stops = await sql`SELECT 1 FROM journey_stops WHERE order_id = ${s.id}`;
			expect(stops.length).toBe(1);
		}
	});

	it('courier scan racing a pickup failure: one wins', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('pickup_booked');
			const shipment = (await row(s.id)).shipment_id;
			await race(lockOrder(s.id), [() => courierEvent(shipment, 'picked_up'), () => pickupFailed(s.id)]);
			expect(await status(s.id)).toBe('in_transit');
			expect((await refundsFor(s.id)).length).toBe(0);
		}
	});

	it('parallel sweeps: only one holds the lock', async () => {
		const s = await orderAt('paid');
		await backdate(s.id, '73 hours');
		const out = await Promise.all([sweep(), sweep(), sweep(), sweep()]);
		expect(out.filter(Boolean).length).toBeGreaterThanOrEqual(1);
		expect((await refundsFor(s.id)).length).toBe(1);
	});

	it('a held sweep lock makes other sweeps skip', async () => {
		const conn = await sql.reserve();
		await conn`SELECT pg_advisory_lock(727002)`;
		expect(await sweep()).toBe(false);
		await conn`SELECT pg_advisory_unlock(727002)`;
		conn.release();
		expect(await sweep()).toBe(true);
	});

	it('give onward and thank-you apply once under parallel clicks', async () => {
		const s = await orderAt('received');
		const onward = await Promise.allSettled(
			[1, 2, 3, 4].map(() => giveOnward(s.reader, s.id, { condition: 'good', note: null }))
		);
		expect(wins(onward)).toBe(1);
		const thanks = await Promise.allSettled([1, 2, 3].map(() => sendThanks(s.reader, s.id, 'Thanks')));
		expect(wins(thanks)).toBe(1);
		const n = await sql`SELECT 1 FROM listings WHERE onward_from = ${s.id}`;
		expect(n.length).toBe(1);
	});

	it('listing at the same moment as requesting stays consistent', async () => {
		const u = await newUser();
		const b = { title: 't', author: 'a', isbn: null, condition: 'good', note: null } as const;
		const ids = await Promise.all([1, 2, 3, 4, 5].map(() => createListing(u, b)));
		const stops = await sql`SELECT count(*)::int AS n FROM journey_stops j JOIN listings l ON l.journey_id = j.journey_id WHERE l.id = ANY(${ids})`;
		expect(stops[0].n).toBe(5);
	});
});

describe('refunds exactly once', () => {
	it('decline racing sweep', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('paid');
			await backdate(s.id, '73 hours');
			await race(lockOrder(s.id), [() => declineOrder(s.giver, s.id), () => sweep()]);
			expect((await refundsFor(s.id)).length).toBe(1);
		}
	});

	it('cancel racing decline', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('paid');
			const r = await race(lockOrder(s.id), [() => cancelOrder(s.reader, s.id), () => declineOrder(s.giver, s.id)]);
			expect(wins(r)).toBe(1);
			expect((await refundsFor(s.id)).length).toBe(1);
		}
	});

	it('both dispute outcomes at once: exactly one applies', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('disputed');
			const r = await race(lockOrder(s.id), [
				() => resolveDispute(s.id, 'refunded'),
				() => resolveDispute(s.id, 'received')
			]);
			expect(wins(r)).toBe(1);
			expect(await status(s.id)).toBe('refunded');
			expect((await refundsFor(s.id)).length).toBe(1);
		}
	});

	it('double admin click refunds once', async () => {
		const s = await orderAt('disputed');
		const r = await race(lockOrder(s.id), [1, 2, 3].map(() => () => resolveDispute(s.id, 'refunded')));
		expect(wins(r)).toBe(1);
		expect((await refundsFor(s.id)).length).toBe(1);
	});

	it('ban racing a decline', async () => {
		for (let i = 0; i < ROUNDS; i++) {
			const s = await orderAt('paid');
			await Promise.allSettled([banUser(s.giver), declineOrder(s.giver, s.id)]);
			expect((await refundsFor(s.id)).length).toBe(1);
		}
	});
});

describe('webhooks under race', () => {
	const SECRET = 'whsec_race';
	const goLive = () => {
		process.env.RAZORPAY_KEY_ID = 'k';
		process.env.RAZORPAY_KEY_SECRET = 's';
		process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
		const refunds: string[] = [];
		vi.stubGlobal('fetch', async (url: string) => {
			if (String(url).endsWith('/orders')) return Response.json({ id: `order_${randomUUID()}` });
			refunds.push(String(url));
			return Response.json({ id: `rfnd_${randomUUID()}` });
		});
		return refunds;
	};
	const hook = (gateway: string, amount: number, paymentId: string, eventId: string = randomUUID()) => {
		const raw = JSON.stringify({
			event: 'payment.captured',
			payload: { payment: { entity: { id: paymentId, order_id: gateway, amount, currency: 'INR' } } }
		});
		return handleWebhook(raw, createHmac('sha256', SECRET).update(raw).digest('hex'), eventId);
	};
	const live = async () => {
		const giver = await newUser();
		const reader = await newUser();
		const listing = await newListing(giver);
		const o = await createOrder(reader, listing, details('handover'));
		return { giver, reader, listing, id: o.id, gateway: o.gateway_order_id!, total: o.total_paise };
	};

	it('the same event delivered in parallel applies once', async () => {
		goLive();
		for (let i = 0; i < ROUNDS; i++) {
			const o = await live();
			const event = randomUUID();
			const paymentId = `pay_${randomUUID()}`;
			await race(lockOrder(o.id), [1, 2, 3, 4].map(() => () => hook(o.gateway, o.total, paymentId, event)));
			expect((await row(o.id)).payment_id).toBe(paymentId);
			expect(await status(o.id)).toBe('paid');
			expect((await refundsFor(o.id)).length).toBe(0);
		}
	});

	it('a late payment replayed in parallel reaches the provider once', async () => {
		const refunds = goLive();
		const o = await live();
		await cancelOrder(o.reader, o.id);
		const paymentId = `pay_${randomUUID()}`;
		await race(lockOrder(o.id), [1, 2, 3, 4].map(() => () => hook(o.gateway, o.total, paymentId)));
		expect(refunds.length).toBe(1);
		expect((await refundsFor(o.id)).length).toBe(1);
	});

	it('capture racing expiry: capture first is paid, expiry does nothing', async () => {
		goLive();
		for (let i = 0; i < ROUNDS; i++) {
			const o = await live();
			await backdate(o.id, '31 minutes');
			await race(lockOrder(o.id), [() => hook(o.gateway, o.total, `pay_${randomUUID()}`), () => sweep()]);
			expect(await status(o.id)).toBe('paid');
			expect((await refundsFor(o.id)).length).toBe(0);
		}
	});

	it('capture racing expiry: expiry first refunds the capture once', async () => {
		const refunds = goLive();
		for (let i = 0; i < ROUNDS; i++) {
			const before = refunds.length;
			const o = await live();
			await backdate(o.id, '31 minutes');
			await race(lockOrder(o.id), [() => sweep(), () => hook(o.gateway, o.total, `pay_${randomUUID()}`)]);
			expect(await status(o.id)).toBe('expired');
			expect((await refundsFor(o.id)).length).toBe(1);
			expect(refunds.length).toBe(before + 1);
		}
	});

	it('capture racing cancel: the money either stays with a paid order or comes back', async () => {
		goLive();
		for (const first of ['capture', 'cancel'] as const) {
			const o = await live();
			const capture = () => hook(o.gateway, o.total, `pay_${randomUUID()}`);
			const cancel = () => cancelOrder(o.reader, o.id);
			await race(lockOrder(o.id), first === 'capture' ? [capture, cancel] : [cancel, capture]);
			expect(await status(o.id)).toBe('cancelled');
			expect((await refundsFor(o.id)).length).toBe(1);
		}
	});
});

describe('test payments under race', () => {
	it('two pay clicks: one order paid, the extra payment refunded', async () => {
		const s = await orderAt('requested');
		await Promise.all([pay(s.id), pay(s.id)]);
		expect(await status(s.id)).toBe('paid');
		expect((await refundsFor(s.id)).length).toBe(1);
	});
});
