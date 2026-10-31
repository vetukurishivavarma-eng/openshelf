import { afterAll, describe, expect, it } from 'vitest';
import { sql } from '../src/lib/server/db';
import {
	MONTHLY_CAP, OrderError, acceptOrder, banUser, cancelOrder, confirmReceived, courierEvent, createListing,
	createOrder, declineOrder, deleteAccount, disputeOrder, giveOnward, markHandedOver, orderFor,
	ordersThisMonth, removeListing, resolveDispute, sendThanks, sweep, type Method, type Status
} from '../src/lib/server/engine';
import { upsertGoogleUser } from '../src/lib/server/auth';
import {
	ADDRESS, PICKUP, backdate, details, expectMoneyIntact, listingStatus, newListing, newUser, orderAt, pay,
	refundsFor, row, status
} from './helpers';

afterAll(expectMoneyIntact);

type Ids = Awaited<ReturnType<typeof orderAt>>;
const ship = async (s: Ids) => (await row(s.id)).shipment_id ?? 'no-shipment';

const ACTIONS: Record<string, (s: Ids) => Promise<unknown>> = {
	accept: (s) => acceptOrder(s.owner, s.id, s.method === 'post' ? PICKUP : null),
	decline: (s) => declineOrder(s.owner, s.id),
	'cancel by reader': (s) => cancelOrder(s.requester, s.id),
	'cancel by giver': (s) => cancelOrder(s.owner, s.id),
	'hand over': (s) => markHandedOver(s.owner, s.id),
	'courier picked up': async (s) => courierEvent(await ship(s), 'picked_up'),
	'courier delivered': async (s) => courierEvent(await ship(s), 'delivered'),
	'courier failed': async (s) => courierEvent(await ship(s), 'failed'),
	received: (s) => confirmReceived(s.requester, s.id),
	dispute: (s) => disputeOrder(s.requester, s.id, 'note'),
	'resolve received': (s) => resolveDispute(s.id, 'received'),
	'resolve refunded': (s) => resolveDispute(s.id, 'refunded')
};

const TERMINAL = { declined: {}, cancelled: {}, expired: {}, received: {}, refunded: {} };
const COMMON = {
	requested: { 'cancel by reader': 'cancelled' },
	paid: { accept: 'pickup_booked', decline: 'declined', 'cancel by reader': 'cancelled' },
	delivered: { received: 'received', dispute: 'disputed' },
	disputed: { 'resolve received': 'received', 'resolve refunded': 'refunded' },
	...TERMINAL
};
const LEGAL: Record<Method, Record<string, Record<string, Status>>> = {
	post: {
		...COMMON,
		pickup_booked: { 'courier picked up': 'in_transit', 'courier delivered': 'delivered', 'courier failed': 'refunded' },
		in_transit: { 'courier delivered': 'delivered', dispute: 'disputed', 'courier failed': 'disputed' }
	} as never,
	handover: {
		...COMMON,
		pickup_booked: { 'hand over': 'delivered', 'cancel by reader': 'cancelled', 'cancel by giver': 'cancelled' }
	} as never
};
// Money comes back on these moves, and only these.
const REFUNDS: Status[] = ['declined', 'cancelled', 'refunded'];

describe.each(['post', 'handover'] as const)('state machine: %s', (method) => {
	for (const [from, legal] of Object.entries(LEGAL[method])) {
		for (const name of Object.keys(ACTIONS)) {
			const to = legal[name];
			it(`${from} + ${name} ${to ? `-> ${to}` : 'is refused'}`, async () => {
				const s = await orderAt(from as Status, method);
				const refundsBefore = (await refundsFor(s.id)).length;
				const paid = !!(await row(s.id)).payment_id;
				if (to) {
					await ACTIONS[name](s);
					expect(await status(s.id)).toBe(to);
					const expected = paid && REFUNDS.includes(to) ? 1 : 0;
					expect((await refundsFor(s.id)).length).toBe(expected);
				} else {
					// Courier scans that do not apply are ignored rather than refused.
					await ACTIONS[name](s).catch((e) => expect(e).toBeInstanceOf(OrderError));
					expect(await status(s.id)).toBe(from);
					expect((await refundsFor(s.id)).length).toBe(refundsBefore);
				}
			});
		}
	}
});

describe('authorisation', () => {
	it('refuses the wrong party and strangers', async () => {
		const stranger = await newUser();
		const paid = await orderAt('paid');
		for (const fn of [
			() => acceptOrder(paid.requester, paid.id, PICKUP),
			() => declineOrder(paid.requester, paid.id),
			() => acceptOrder(stranger, paid.id, PICKUP),
			() => cancelOrder(stranger, paid.id),
			() => cancelOrder(paid.owner, paid.id)
		])
			await expect(fn()).rejects.toBeInstanceOf(OrderError);
		const delivered = await orderAt('delivered');
		for (const fn of [
			() => confirmReceived(delivered.owner, delivered.id),
			() => disputeOrder(delivered.owner, delivered.id, 'x'),
			() => confirmReceived(stranger, delivered.id)
		])
			await expect(fn()).rejects.toBeInstanceOf(OrderError);
		expect(await status(delivered.id)).toBe('delivered');
	});

	it('a courier order needs a pickup address; a handover does not', async () => {
		const s = await orderAt('paid');
		await expect(acceptOrder(s.owner, s.id, null)).rejects.toThrow('collect from');
		expect(await status(s.id)).toBe('paid');
		const h = await orderAt('paid', 'handover');
		await acceptOrder(h.owner, h.id, null);
		expect((await row(h.id)).shipment_id).toBeNull();
	});

	it('hand-over is refused on courier orders', async () => {
		const s = await orderAt('pickup_booked');
		await expect(markHandedOver(s.owner, s.id)).rejects.toThrow('courier');
	});
});

describe('prices', () => {
	it('fee only for a handover, fee plus quote for a courier, in integer paise', async () => {
		const h = await row((await orderAt('requested', 'handover')).id);
		expect([h.fee_paise, h.courier_paise, h.total_paise]).toEqual([3900, 0, 3900]);
		const p = await row((await orderAt('requested', 'post')).id);
		expect([p.fee_paise, p.courier_paise, p.total_paise]).toEqual([3900, 8900, 12800]);
	});

	it('the database derives the total', async () => {
		const s = await orderAt('requested');
		await expect(sql`UPDATE orders SET total_paise = 1 WHERE id = ${s.id}`).rejects.toThrow();
	});
});

describe('request rules', () => {
	it('refuses your own book', async () => {
		const u = await newUser();
		await expect(createOrder(u, await newListing(u), details('post'))).rejects.toThrow('your own');
	});

	it('allows one open order per listing, also at the database', async () => {
		const s = await orderAt('requested');
		const other = await newUser();
		await expect(createOrder(other, s.listing, details('post'))).rejects.toBeInstanceOf(OrderError);
		await expect(
			sql`INSERT INTO orders (listing_id, owner_id, requester_id, method) VALUES (${s.listing}, ${s.owner}, ${other}, 'post')`
		).rejects.toMatchObject({ code: '23505' });
	});

	it('requires a complete profile and a delivery address for courier', async () => {
		const u = await newUser();
		const l = await newListing(await newUser());
		await expect(createOrder(u, l, { method: 'post', address: null, pincode: null })).rejects.toThrow('address');
		await sql`UPDATE users SET city = NULL WHERE id = ${u}`;
		await expect(createOrder(u, l, details('post'))).rejects.toThrow('profile');
		await expect(createListing(u, { title: 't', author: 'a', isbn: null, condition: 'good', note: null })).rejects.toThrow('profile');
	});
});

describe('monthly cap', () => {
	const place = async (u: string) => createOrder(u, await newListing(await newUser()), details('handover'));

	it(`refuses the order after ${MONTHLY_CAP}`, async () => {
		const u = await newUser();
		for (let i = 0; i < MONTHLY_CAP; i++) await place(u);
		expect(await ordersThisMonth(u)).toBe(MONTHLY_CAP);
		await expect(place(u)).rejects.toThrow('limit of 3');
	});

	it('cancelled, declined, expired and refunded orders do not count', async () => {
		const u = await newUser();
		const a = await place(u);
		await cancelOrder(u, a.id);
		const b = await place(u);
		await pay(b.id);
		await declineOrder(b.owner_id, b.id);
		expect(await ordersThisMonth(u)).toBe(0);
	});

	it('completed orders do count', async () => {
		const s = await orderAt('received');
		expect(await ordersThisMonth(s.requester)).toBe(1);
	});

	it('resets at the start of the month in India, not UTC', async () => {
		const u = await newUser();
		const orders = [await place(u), await place(u), await place(u)];
		const startOfMonth = sql`date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;
		await sql`UPDATE orders SET created_at = ${startOfMonth} - interval '1 minute' WHERE id = ${orders[0].id}`;
		expect(await ordersThisMonth(u)).toBe(2);
		await place(u);
		await sql`UPDATE orders SET created_at = ${startOfMonth} + interval '1 minute' WHERE id = ${orders[1].id}`;
		expect(await ordersThisMonth(u)).toBe(3);
		await expect(place(u)).rejects.toThrow('limit of 3');
	});
});

describe('sweep', () => {
	it.each([
		['requested', '31 minutes', 'expired', 0],
		['paid', '73 hours', 'expired', 1],
		['pickup_booked', '121 hours', 'refunded', 1],
		['in_transit', '505 hours', 'disputed', 0],
		['delivered', '337 hours', 'received', 0]
	] as const)('%s after %s -> %s with %i refunds', async (from, age, to, refunds) => {
		const s = await orderAt(from);
		await backdate(s.id, age);
		await sweep();
		expect(await status(s.id)).toBe(to);
		expect((await refundsFor(s.id)).length).toBe(refunds);
	});

	it('an unanswered handover expires with a refund', async () => {
		const s = await orderAt('pickup_booked', 'handover');
		await backdate(s.id, '121 hours');
		await sweep();
		expect(await status(s.id)).toBe('expired');
		expect((await refundsFor(s.id)).length).toBe(1);
		expect(await listingStatus(s.listing)).toBe('available');
	});

	it.each([
		['requested', '29 minutes'],
		['paid', '71 hours'],
		['pickup_booked', '119 hours'],
		['in_transit', '503 hours'],
		['delivered', '335 hours'],
		['disputed', '5000 hours']
	] as const)('%s after %s stays put', async (from, age) => {
		const s = await orderAt(from);
		await backdate(s.id, age);
		await sweep();
		expect(await status(s.id)).toBe(from);
	});

	it('is idempotent', async () => {
		const s = await orderAt('paid');
		await backdate(s.id, '73 hours');
		await sweep();
		await sweep();
		await sweep();
		expect((await refundsFor(s.id)).length).toBe(1);
	});

	it('warns once per stage', async () => {
		const s = await orderAt('paid');
		await backdate(s.id, '49 hours');
		await sweep();
		const first = (await row(s.id)).warned_at;
		expect(first).not.toBeNull();
		await sweep();
		expect((await row(s.id)).warned_at).toEqual(first);
	});
});

describe('address wipe and contact privacy', () => {
	it.each(['declined', 'cancelled', 'expired', 'received', 'refunded'] as const)('wiped at %s', async (end) => {
		const s = await orderAt(end);
		const o = await row(s.id);
		expect([o.address, o.pickup_address]).toEqual([null, null]);
	});

	it('kept while the book is moving, and wiped after a failed pickup', async () => {
		const s = await orderAt('in_transit');
		const o = await row(s.id);
		expect([o.address, o.pickup_address]).toEqual([ADDRESS, PICKUP]);
		const f = await orderAt('pickup_booked');
		await courierEvent((await row(f.id)).shipment_id, 'failed');
		const w = await row(f.id);
		expect([w.address, w.pickup_address]).toEqual([null, null]);
	});

	it('the database refuses an address on a closed order', async () => {
		const s = await orderAt('received');
		await expect(sql`UPDATE orders SET address = 'x' WHERE id = ${s.id}`).rejects.toMatchObject({ code: '23514' });
		await expect(sql`UPDATE orders SET pickup_address = 'x' WHERE id = ${s.id}`).rejects.toMatchObject({ code: '23514' });
	});

	it('contact shows only to the parties, only from acceptance, and addresses never cross', async () => {
		const s = await orderAt('paid');
		const stranger = await newUser();
		expect(await orderFor(s.id, stranger)).toBeNull();
		expect((await orderFor(s.id, s.owner))!.whatsapp).toBeNull();
		expect((await orderFor(s.id, s.requester))!.whatsapp).toBeNull();

		await acceptOrder(s.owner, s.id, PICKUP);
		const [g] = await sql`SELECT whatsapp FROM users WHERE id = ${s.owner}`;
		const [r] = await sql`SELECT whatsapp FROM users WHERE id = ${s.requester}`;
		const giver = (await orderFor(s.id, s.owner))!;
		const reader = (await orderFor(s.id, s.requester))!;
		expect(giver.whatsapp).toBe(r.whatsapp);
		expect(reader.whatsapp).toBe(g.whatsapp);
		expect(JSON.stringify(giver)).not.toContain(ADDRESS);
		expect(JSON.stringify(reader)).not.toContain(PICKUP);
		expect(giver.total_paise).toBeNull();
		expect(reader.gateway_order_id).toBeTruthy();
		expect(await orderFor(s.id, stranger)).toBeNull();
	});

	it('contact disappears from a closed order that never completed', async () => {
		const s = await orderAt('pickup_booked', 'handover');
		await cancelOrder(s.requester, s.id);
		expect((await orderFor(s.id, s.requester))!.whatsapp).toBeNull();
	});
});

describe('journey', () => {
	const book = { title: 'T', author: 'A', isbn: null, condition: 'good', note: 'Enjoy it' } as const;
	const cities = async (listing: string) =>
		(await sql`SELECT s.city FROM journey_stops s JOIN listings l ON l.journey_id = s.journey_id
			WHERE l.id = ${listing} ORDER BY s.id`).map((r) => r.city);

	it('grows by a city per reader, across a give-onward', async () => {
		const giver = await newUser('A', 'Pune');
		const first = await newUser('B', 'Kochi');
		const second = await newUser('C', 'Indore');
		const l1 = await createListing(giver, book);
		expect(await cities(l1)).toEqual(['Pune']);

		const o1 = await createOrder(first, l1, details('handover'));
		await pay(o1.id);
		await acceptOrder(giver, o1.id, null);
		await markHandedOver(giver, o1.id);
		await confirmReceived(first, o1.id);
		expect(await cities(l1)).toEqual(['Pune', 'Kochi']);

		const l2 = await giveOnward(first, o1.id, { condition: 'worn', note: 'Second life' });
		expect(await cities(l2)).toEqual(['Pune', 'Kochi']);
		const [meta] = await sql`SELECT title, author, condition, note, status FROM listings WHERE id = ${l2}`;
		expect({ ...meta }).toEqual({ title: 'T', author: 'A', condition: 'worn', note: 'Second life', status: 'available' });

		const o2 = await createOrder(second, l2, details('handover'));
		await pay(o2.id);
		await acceptOrder(first, o2.id, null);
		await markHandedOver(first, o2.id);
		await confirmReceived(second, o2.id);
		expect(await cities(l1)).toEqual(['Pune', 'Kochi', 'Indore']);
	});

	it('records a stop for auto-confirm and upheld-against disputes, but not a refund', async () => {
		const a = await orderAt('delivered');
		await backdate(a.id, '337 hours');
		await sweep();
		expect((await cities(a.listing)).length).toBe(2);
		const b = await orderAt('disputed');
		await resolveDispute(b.id, 'received');
		expect((await cities(b.listing)).length).toBe(2);
		const c = await orderAt('refunded');
		expect((await cities(c.listing)).length).toBe(1);
	});

	it('stop rows carry no reference to a person', async () => {
		const columns = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'journey_stops'`;
		expect(columns.map((c) => c.column_name).sort()).toEqual(['city', 'created_at', 'id', 'journey_id', 'order_id']);
	});

	it('only the receiver can give onward, once, after receipt', async () => {
		const s = await orderAt('received');
		await expect(giveOnward(s.owner, s.id, { condition: 'good', note: null })).rejects.toBeInstanceOf(OrderError);
		await giveOnward(s.requester, s.id, { condition: 'good', note: null });
		await expect(giveOnward(s.requester, s.id, { condition: 'good', note: null })).rejects.toThrow('already');
		const early = await orderAt('delivered');
		await expect(giveOnward(early.requester, early.id, { condition: 'good', note: null })).rejects.toThrow('once you have received');
	});

	it('the note reaches the reader once paid, and no one else', async () => {
		const owner = await newUser();
		const reader = await newUser();
		const id = await createListing(owner, { ...book, note: 'A private word' });
		const o = await createOrder(reader, id, details('handover'));
		expect((await orderFor(o.id, reader))!.note).toBeNull();
		await pay(o.id);
		expect((await orderFor(o.id, reader))!.note).toBe('A private word');
		expect(await orderFor(o.id, await newUser())).toBeNull();
	});

	it('thank-you: receiver only, after receipt, once; the giver reads it', async () => {
		const s = await orderAt('delivered');
		await expect(sendThanks(s.requester, s.id, 'Early')).rejects.toBeInstanceOf(OrderError);
		await confirmReceived(s.requester, s.id);
		await expect(sendThanks(s.owner, s.id, 'Me')).rejects.toBeInstanceOf(OrderError);
		await sendThanks(s.requester, s.id, 'Thank you');
		await expect(sendThanks(s.requester, s.id, 'Again')).rejects.toBeInstanceOf(OrderError);
		expect((await orderFor(s.id, s.owner))!.thank_you).toBe('Thank you');
	});

	it('the database limits notes and thank-yous to 280 characters', async () => {
		const s = await orderAt('received');
		await expect(sql`UPDATE orders SET thank_you = ${'x'.repeat(281)} WHERE id = ${s.id}`).rejects.toMatchObject({ code: '23514' });
		await expect(sql`UPDATE listings SET note = ${'x'.repeat(281)} WHERE id = ${s.listing}`).rejects.toMatchObject({ code: '23514' });
	});
});

describe('ban and delete', () => {
	for (const [name, close] of [['ban', banUser], ['delete', deleteAccount]] as const) {
		it(`${name}: giver's unsent orders are refunded and listings vanish`, async () => {
			const paid = await orderAt('paid');
			const spare = await newListing(paid.owner);
			await close(paid.owner);
			expect(await status(paid.id)).toBe('cancelled');
			expect((await refundsFor(paid.id)).length).toBe(1);
			expect(await listingStatus(paid.listing)).toBe('removed');
			expect(await listingStatus(spare)).toBe('removed');
			await expect(createOrder(await newUser(), spare, details('post'))).rejects.toBeInstanceOf(OrderError);
		});

		it(`${name}: a booked pickup is refunded either way`, async () => {
			const a = await orderAt('pickup_booked');
			await close(a.owner);
			expect(await status(a.id)).toBe('refunded');
			expect((await refundsFor(a.id)).length).toBe(1);
			const b = await orderAt('pickup_booked');
			await close(b.requester);
			expect(await status(b.id)).toBe('refunded');
			expect((await refundsFor(b.id)).length).toBe(1);
			expect(await listingStatus(b.listing)).toBe('available');
		});

		it(`${name}: an unpaid order closes with no refund`, async () => {
			const s = await orderAt('requested');
			await close(s.requester);
			expect(await status(s.id)).toBe('cancelled');
			expect((await refundsFor(s.id)).length).toBe(0);
		});

		it(`${name}: a book already moving stays open, and the address goes now`, async () => {
			const s = await orderAt('in_transit');
			await close(s.requester);
			const o = await row(s.id);
			expect([o.status, o.address]).toEqual(['in_transit', null]);
			expect((await refundsFor(s.id)).length).toBe(0);
		});
	}

	it('delete anonymises and wipes what they wrote', async () => {
		const s = await orderAt('received');
		await sendThanks(s.requester, s.id, 'Thanks from Zubeida');
		await sql`UPDATE listings SET note = 'From Zubeida' WHERE id = ${s.listing}`;
		await deleteAccount(s.requester);
		await deleteAccount(s.owner);
		const [u] = await sql`SELECT * FROM users WHERE id = ${s.requester}`;
		for (const k of ['email', 'google_sub', 'city', 'pincode', 'whatsapp']) expect(u[k]).toBeNull();
		expect(u.name).toBe('Former reader');
		expect((await row(s.id)).thank_you).toBeNull();
		const [l] = await sql`SELECT note FROM listings WHERE id = ${s.listing}`;
		expect(l.note).toBeNull();
	});

	it('banned users cannot order or list, and lose their sessions', async () => {
		const u = await newUser();
		await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${`h${u}`}, ${u}, now() + interval '1 day')`;
		const l = await newListing(await newUser());
		await banUser(u);
		await expect(createOrder(u, l, details('post'))).rejects.toThrow('unavailable');
		await expect(createListing(u, { title: 't', author: 'a', isbn: null, condition: 'good', note: null })).rejects.toThrow('unavailable');
		expect((await sql`SELECT 1 FROM sessions WHERE user_id = ${u}`).length).toBe(0);
	});

	describe('a Google account returning after deletion', () => {
		const signUp = async () => {
			const sub = `sub-${Math.random()}`;
			return { sub, id: (await upsertGoogleUser(sub, `${sub}@x.test`, 'R'))! };
		};

		it('banned then deleted cannot return', async () => {
			const { sub, id } = await signUp();
			await banUser(id);
			await deleteAccount(id);
			expect(await upsertGoogleUser(sub, `${sub}@x.test`, 'R')).toBeNull();
		});

		it('deleted then banned from an open report cannot return', async () => {
			const { sub, id } = await signUp();
			await deleteAccount(id);
			await banUser(id);
			expect(await upsertGoogleUser(sub, `${sub}@x.test`, 'R')).toBeNull();
		});

		it('deleted and never banned can, as a new account', async () => {
			const { sub, id } = await signUp();
			await deleteAccount(id);
			const again = await upsertGoogleUser(sub, `${sub}@x.test`, 'R');
			expect(again).toBeTruthy();
			expect(again).not.toBe(id);
		});

		it('keeps a salted hash, not the id', async () => {
			const { sub, id } = await signUp();
			await deleteAccount(id);
			const [u] = await sql`SELECT deleted_sub_hash FROM users WHERE id = ${id}`;
			expect(u.deleted_sub_hash).toMatch(/^[0-9a-f]{64}$/);
			expect(u.deleted_sub_hash).not.toContain(sub);
		});
	});
});

describe('listing removal', () => {
	it('only your own, only while available', async () => {
		const s = await orderAt('requested');
		await expect(removeListing(s.owner, s.listing)).rejects.toBeInstanceOf(OrderError);
		const free = await newListing(s.owner);
		await expect(removeListing(s.requester, free)).rejects.toBeInstanceOf(OrderError);
		await removeListing(s.owner, free);
		expect(await listingStatus(free)).toBe('removed');
	});
});

describe('invariant', () => {
	it('money stays intact after a randomised run', async () => {
		const seed = Number(process.env.SEED ?? Date.now() % 2 ** 31);
		console.log(`randomised run seed=${seed}`);
		let state = seed;
		const rand = () => {
			// mulberry32
			state = (state + 0x6d2b79f5) | 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
		};
		const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

		const users: string[] = [];
		for (let i = 0; i < 10; i++) users.push(await newUser());
		const listings: string[] = [];
		for (const u of users) listings.push(await newListing(u));
		const orders: string[] = [];

		const onOrder = (fn: (id: string, o: Record<string, string>) => Promise<unknown>) => async () => {
			const id = pick(orders);
			if (id) await fn(id, await row(id));
		};
		const ops: (() => Promise<unknown>)[] = [
			async () => listings.push(await newListing(pick(users))),
			async () => orders.push((await createOrder(pick(users), pick(listings), details(rand() < 0.5 ? 'post' : 'handover'))).id),
			async () => orders.push((await createOrder(pick(users), pick(listings), details('handover'))).id),
			() => removeListing(pick(users), pick(listings)),
			onOrder((id) => pay(id)),
			onOrder((id) => pay(id)),
			onOrder((id, o) => acceptOrder(o.owner_id, id, PICKUP)),
			onOrder((id, o) => declineOrder(o.owner_id, id)),
			onOrder((id, o) => cancelOrder(rand() < 0.5 ? o.owner_id : o.requester_id, id)),
			onOrder((id, o) => markHandedOver(o.owner_id, id)),
			onOrder((id, o) => courierEvent(o.shipment_id ?? 'x', pick(['picked_up', 'delivered', 'failed'] as const))),
			onOrder((id, o) => confirmReceived(o.requester_id, id)),
			onOrder((id, o) => disputeOrder(o.requester_id, id, 'n')),
			onOrder((id) => resolveDispute(id, rand() < 0.5 ? 'received' : 'refunded')),
			onOrder(async (id) => {
				await backdate(id, `${Math.floor(rand() * 600)} hours`);
				await sweep();
			})
		];

		const done = { ok: 0, refused: 0 };
		for (let round = 0; round < 150; round++) {
			// Parallel batches, so operations interleave on separate connections.
			const results = await Promise.allSettled(Array.from({ length: 5 }, () => pick(ops)()));
			for (const r of results) {
				if (r.status === 'fulfilled') done.ok++;
				else if (r.reason instanceof OrderError) done.refused++;
				else throw r.reason;
			}
			if (round === 75) await banUser(users[0]);
			if (round === 100) await deleteAccount(users[1]);
			// The monthly cap would otherwise end the run early.
			if (round % 10 === 0) await sql`UPDATE orders SET created_at = created_at - interval '40 days'`;
		}
		console.log('randomised run', done, 'orders', orders.length);
		expect(orders.length).toBeGreaterThan(10);
		expect(done.ok).toBeGreaterThan(50);
		await expectMoneyIntact();
	});
});
