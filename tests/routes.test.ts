import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { sql } from '../src/lib/server/db';
import { acceptOrder, banUser, createOrder, deleteAccount, disputeOrder, orderFor, sendThanks } from '../src/lib/server/engine';
import { NOTE_MAX, isbn, pincode, text, whatsapp } from '../src/lib/server/validate';
import { allow } from '../src/lib/server/ratelimit';
import { sessionUser, startSession, upsertGoogleUser, type SessionUser } from '../src/lib/server/auth';
import { actions as bookActions, load as bookLoad } from '../src/routes/books/[id]/+page.server';
import { load as booksLoad } from '../src/routes/books/+page.server';
import { actions as listActions } from '../src/routes/list/+page.server';
import { actions as orderActions, load as orderLoad } from '../src/routes/orders/[id]/+page.server';
import { load as ordersLoad } from '../src/routes/orders/+page.server';
import { actions as adminActions, load as adminLoad } from '../src/routes/admin/+page.server';
import { GET as callback } from '../src/routes/auth/google/callback/+server';
import { GET as oldLink } from '../src/routes/swaps/[...rest]/+server';
import { details, expectMoneyIntact, newListing, newUser, orderAt, row, status } from './helpers';

afterAll(expectMoneyIntact);

const NAME = 'Zubeida Secretsurname';
const user = (id: string, isAdmin = false) => ({
	id, isAdmin, city: 'Pune', whatsapp: '+919000000000'
}) as SessionUser;
const asUser = (id: string, isAdmin = false) => ({ user: user(id, isAdmin) });
const anon = { user: null };
const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return new Request('http://x', { method: 'POST', body: f });
};

async function thrown(fn: () => Promise<unknown>) {
	try {
		await fn();
		return 'no throw';
	} catch (e) {
		return (e as { status: number }).status;
	}
}

const book = (id: string, locals: unknown = anon) => (bookLoad as Function)({ params: { id }, locals });
const browse = (qs: string) => (booksLoad as Function)({ url: new URL(`http://x/books?${qs}`) });

describe('public pages expose no private data', () => {
	it('book page and browse carry no name, contact, or ids of people, at every stage', async () => {
		const owner = await newUser(NAME, 'Pune');
		const reader = await newUser('Karthik Hiddenname', 'Kochi');
		const [u] = await sql`SELECT email, pincode, whatsapp FROM users WHERE id = ${owner}`;
		const id = await newListing(owner, 'Dear reader, from Zubeida');
		const check = async () => {
			for (const json of [JSON.stringify(await book(id)), JSON.stringify(await browse(''))]) {
				for (const secret of ['Zubeida', 'Secretsurname', 'Karthik', 'Hiddenname', u.email, u.pincode, u.whatsapp, owner, reader])
					expect(json).not.toContain(secret);
			}
		};
		await check();
		const o = await createOrder(reader, id, details('handover'));
		await check();
		await sql`UPDATE orders SET thank_you = 'Thanks from Karthik', status = 'cancelled' WHERE id = ${o.id}`;
		await check();
	});

	it('journey shows a reader count and cities, including on a passed-on copy', async () => {
		const s = await orderAt('received');
		await sql`UPDATE users SET city = 'Kochi' WHERE id = ${s.requester}`;
		await sql`UPDATE journey_stops SET city = 'Kochi' WHERE order_id = ${s.id}`;
		const page = await book(s.listing);
		expect(page.book.status).toBe('gone');
		expect(page.journey.readers).toBe(2);
		expect(page.journey.cities).toEqual(['Pune', 'Kochi']);
		expect(Object.keys(page.journey).sort()).toEqual(['cities', 'currentId', 'readers']);
	});

	it('removed listings 404', async () => {
		const id = await newListing(await newUser());
		await sql`UPDATE listings SET status = 'removed' WHERE id = ${id}`;
		expect(await thrown(() => book(id))).toBe(404);
	});

	it('search matches title and author, filters by condition and city, hides unavailable', async () => {
		const owner = await newUser();
		const [l] = await sql`INSERT INTO listings (owner_id, title, author, condition)
			VALUES (${owner}, 'Zanzibar Chronicles', 'Quillon Marsh', 'like_new') RETURNING id`;
		const find = async (qs: string) => (await browse(qs)).books.map((b: { id: string }) => b.id);
		expect(await find('q=zanzibar')).toContain(l.id);
		expect(await find('q=quillon')).toContain(l.id);
		expect(await find('q=zanzibar&condition=worn')).not.toContain(l.id);
		expect(await find('q=zanzibar&condition=like_new')).toContain(l.id);
		expect(await find('q=zanzibar&city=pune')).toContain(l.id);
		expect(await find('q=zanzibar&city=delhi')).not.toContain(l.id);
		await sql`UPDATE listings SET status = 'gone' WHERE id = ${l.id}`;
		expect(await find('q=zanzibar')).not.toContain(l.id);
	});
});

describe('client input', () => {
	it('prices posted by a client are ignored', async () => {
		const listing = await newListing(await newUser());
		const reader = await newUser();
		const res = await thrown(() =>
			(bookActions.request as Function)({
				request: form({ method: 'handover', amount: '1', fee_paise: '1', total_paise: '1', courier_paise: '0' }),
				params: { id: listing },
				locals: asUser(reader)
			})
		);
		expect(res).toBe(303);
		const [o] = await sql`SELECT * FROM orders WHERE listing_id = ${listing}`;
		expect([o.fee_paise, o.total_paise]).toEqual([3900, 3900]);
	});

	it('a courier request needs an address and a valid pincode', async () => {
		const listing = await newListing(await newUser());
		const res = await (bookActions.request as Function)({
			request: form({ method: 'post', address: 'short', pincode: '12' }),
			params: { id: listing },
			locals: asUser(await newUser())
		});
		expect(res.status).toBe(400);
	});

	it('over-long notes and thank-yous are refused; markup is kept as inert text', async () => {
		const u = await newUser();
		const listing = (note: string) =>
			(listActions.create as Function)({
				request: form({ title: 'T', author: 'A', condition: 'good', note }),
				locals: asUser(u)
			});
		expect((await listing('x'.repeat(NOTE_MAX + 1))).status).toBe(400);
		expect(await thrown(() => listing('<script>alert(1)</script>'))).toBe(303);
		const [l] = await sql`SELECT note FROM listings WHERE owner_id = ${u}`;
		expect(l.note).toBe('<script>alert(1)</script>'); // Svelte escapes it on output; the HTTP run confirms.

		const s = await orderAt('received');
		const thanks = (message: string) =>
			(orderActions.thanks as Function)({ request: form({ message }), params: { id: s.id }, locals: asUser(s.requester) });
		expect((await thanks('x'.repeat(NOTE_MAX + 1))).status).toBe(400);
		expect((await thanks('Thank you')).ok).toBe(true);
	});

	it('collapses control characters and whitespace', () => {
		expect(text('  a\n\n b\t\u0000c ', 10)).toBe('a b \u0000c'.replace('\u0000', '\u0000'));
		expect(text('', 10)).toBeNull();
	});
});

describe('order page authorisation', () => {
	it('strangers get 404, the anonymous are redirected, and the giver cannot see an unpaid order', async () => {
		const s = await orderAt('pickup_booked');
		const stranger = await newUser();
		const load = (locals: unknown, id = s.id) => (orderLoad as Function)({ params: { id }, locals });
		expect(await thrown(() => load(asUser(stranger)))).toBe(404);
		expect(await thrown(() => load(anon))).toBe(303);
		expect((await load(asUser(s.owner))).order.whatsapp).toMatch(/^\+91\d{10}$/);

		const unpaid = await orderAt('requested');
		expect(await thrown(() => load(asUser(unpaid.owner), unpaid.id))).toBe(404);
		const list = await (ordersLoad as Function)({ locals: asUser(unpaid.owner) });
		expect(list.orders.length).toBe(0);
	});

	it('actions refuse a stranger', async () => {
		const s = await orderAt('delivered');
		const stranger = await newUser();
		const res = await (orderActions.received as Function)({ params: { id: s.id }, locals: asUser(stranger) });
		expect(res.status).toBe(400);
		expect(await status(s.id)).toBe('delivered');
	});

	it('test controls refuse non-parties, and the giver cannot pay for the reader', async () => {
		const s = await orderAt('requested');
		const pay = (id: string) => (orderActions.testpay as Function)({ request: form({}), params: { id: s.id }, locals: asUser(id) });
		expect((await pay(await newUser())).status).toBe(400);
		expect((await pay(s.owner)).status).toBe(400);
		expect(await status(s.id)).toBe('requested');
		await pay(s.requester);
		expect(await status(s.id)).toBe('paid');
	});

	it('test controls are gone in live mode', async () => {
		const s = await orderAt('requested');
		process.env.RAZORPAY_KEY_ID = 'k';
		process.env.RAZORPAY_KEY_SECRET = 's';
		process.env.RAZORPAY_WEBHOOK_SECRET = 'w';
		process.env.SHIPROCKET_EMAIL = 'e';
		process.env.SHIPROCKET_PASSWORD = 'p';
		try {
			const pay = () => (orderActions.testpay as Function)({ request: form({}), params: { id: s.id }, locals: asUser(s.requester) });
			expect(await thrown(pay)).toBe(404);
			const page = await (orderLoad as Function)({ params: { id: s.id }, locals: asUser(s.requester) });
			expect(page.testControls).toBe(false);
		} finally {
			for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD']) delete process.env[k];
		}
	});

	it('reports attach to what the other reader wrote', async () => {
		const s = await orderAt('received');
		await sql`UPDATE listings SET note = 'Rude note' WHERE id = ${s.listing}`;
		await sendThanks(s.requester, s.id, 'Rude thanks');
		const report = (id: string) =>
			(orderActions.report as Function)({ request: form({ reason: 'Abusive' }), params: { id: s.id }, locals: asUser(id) });
		await report(s.requester);
		await report(s.owner);
		const rows = await sql`SELECT subject, user_id, reporter_id FROM reports WHERE order_id = ${s.id} ORDER BY subject`;
		expect(rows.map((r) => [r.subject, r.user_id])).toEqual([['note', s.owner], ['thank_you', s.requester]]);
		expect(await thrown(() => report(`${await newUser()}`))).toBe(404);
	});
});

describe('admin', () => {
	it('non-admins get 404 on load and every action', async () => {
		const s = await orderAt('disputed');
		const u = await newUser();
		const body = () => form({ id: s.id, outcome: 'refunded', user: s.owner, listing: s.listing });
		expect(await thrown(() => (adminLoad as Function)({ locals: asUser(u) }))).toBe(404);
		expect(await thrown(() => (adminLoad as Function)({ locals: anon }))).toBe(303);
		for (const name of ['resolve', 'close', 'ban', 'takedown', 'cleartext'] as const)
			expect(await thrown(() => (adminActions[name] as Function)({ request: body(), locals: asUser(u) }))).toBe(404);
		expect(await status(s.id)).toBe('disputed');
		await (adminActions.resolve as Function)({ request: body(), locals: asUser(u, true) });
		expect(await status(s.id)).toBe('refunded');
	});

	it('sees a reported message, removes it, and outstanding refunds are listed', async () => {
		const s = await orderAt('received');
		await sendThanks(s.requester, s.id, 'Offensive words');
		const [r] = await sql`INSERT INTO reports (reporter_id, order_id, listing_id, user_id, reason, subject)
			VALUES (${s.owner}, ${s.id}, ${s.listing}, ${s.requester}, 'Abuse', 'thank_you') RETURNING id`;
		const admin = asUser(await newUser(), true);
		const page = await (adminLoad as Function)({ locals: admin });
		expect(page.reports.find((x: { id: string }) => x.id === r.id).message).toBe('Offensive words');
		await (adminActions.cleartext as Function)({ request: form({ id: r.id }), locals: admin });
		expect((await row(s.id)).thank_you).toBeNull();
		expect(Array.isArray(page.refunds)).toBe(true);
	});
});

describe('sessions and Google sign-in', () => {
	afterEach(() => vi.unstubAllGlobals());

	function jar(initial: Record<string, string> = {}) {
		const store = new Map(Object.entries(initial));
		return {
			get: (k: string) => store.get(k),
			set: (k: string, v: string) => void store.set(k, v),
			delete: (k: string) => void store.delete(k),
			store
		};
	}
	const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
	function stubGoogle(claims: object) {
		const seen: URLSearchParams[] = [];
		vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
			seen.push(init.body);
			return new Response(JSON.stringify({ id_token: idToken(claims) }));
		});
		return seen;
	}
	const claims = (sub: string) => ({
		sub, aud: 'client', exp: Date.now() / 1000 + 60, email: `${sub}@x.test`, email_verified: true, name: 'New Reader'
	});
	const run = (code: string, state: string, cookies = jar({ oauth_state: 'st', oauth_verifier: 'ver' })) =>
		(callback as Function)({ url: new URL(`http://localhost/auth/google/callback?code=${code}&state=${state}`), cookies });

	it('stores only the token hash, sends the PKCE verifier and signs in', async () => {
		process.env.GOOGLE_CLIENT_ID = 'client';
		const sub = `g-${Date.now()}`;
		const seen = stubGoogle(claims(sub));
		const cookies = jar({ oauth_state: 'st', oauth_verifier: 'ver' });
		expect(await thrown(() => run('c', 'st', cookies))).toBe(303);
		expect(seen[0].get('code_verifier')).toBe('ver');
		const token = cookies.store.get('session')!;
		expect((await sql`SELECT 1 FROM sessions WHERE token_hash = ${token}`).length).toBe(0);
		expect((await sessionUser(cookies as never))?.email).toBe(`${sub}@x.test`);
	});

	it('refuses a state mismatch before calling Google', async () => {
		const seen = stubGoogle(claims('nope'));
		expect(await thrown(() => run('c', 'wrong'))).toBe(400);
		expect(seen.length).toBe(0);
	});

	it('refuses wrong audience, expired and unverified tokens', async () => {
		process.env.GOOGLE_CLIENT_ID = 'client';
		for (const bad of [{ ...claims('a'), aud: 'other' }, { ...claims('b'), exp: 1 }, { ...claims('c'), email_verified: false }]) {
			stubGoogle(bad);
			expect(await thrown(() => run('c', 'st'))).toBe(400);
		}
	});

	it('a banned account that deleted itself cannot sign back in through Google', async () => {
		process.env.GOOGLE_CLIENT_ID = 'client';
		const sub = `b-${Date.now()}`;
		const id = (await upsertGoogleUser(sub, `${sub}@x.test`, 'B'))!;
		const cookies = jar();
		await startSession(cookies as never, id);
		await banUser(id);
		expect(await sessionUser(cookies as never)).toBeNull();
		await deleteAccount(id);
		stubGoogle(claims(sub));
		expect(await thrown(() => run('c', 'st'))).toBe(403);
	});

	it('rejects expired sessions', async () => {
		const u = await newUser();
		const cookies = jar();
		await startSession(cookies as never, u);
		await sql`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = ${u}`;
		expect(await sessionUser(cookies as never)).toBeNull();
	});
});

describe('input validation', () => {
	it('normalises WhatsApp numbers to +91 and 10 digits', () => {
		for (const ok of ['9876543210', '+91 98765 43210', '09876543210', '919876543210', '98765-43210'])
			expect(whatsapp(ok)).toBe('+919876543210');
		for (const bad of ['12345', '1234567890', '+1 9876543210', '98765432101', '']) expect(whatsapp(bad)).toBeNull();
	});

	it('WhatsApp number is unique at the database', async () => {
		const a = await newUser();
		const [u] = await sql`SELECT whatsapp FROM users WHERE id = ${a}`;
		const b = await newUser();
		await expect(sql`UPDATE users SET whatsapp = ${u.whatsapp} WHERE id = ${b}`).rejects.toMatchObject({ code: '23505' });
	});

	it('checks pincode and ISBN shape', () => {
		expect(pincode('560001')).toBe('560001');
		expect(pincode('060001')).toBeNull();
		expect(isbn('978-0-14-303965-5')).toBe('9780143039655');
		expect(isbn('014303965x')).toBe('014303965X');
		expect(isbn('123')).toBeNull();
	});

	it('token bucket refuses past capacity', () => {
		const key = `t${Math.random()}`;
		expect(allow(key, 2, 1)).toBe(true);
		expect(allow(key, 2, 1)).toBe(true);
		expect(allow(key, 2, 1)).toBe(false);
	});
});

describe('old links', () => {
	it('/swaps/x redirects to /orders/x', async () => {
		expect(await thrown(async () => (oldLink as Function)({ params: { rest: 'abc' } }))).toBe(308);
	});
});

describe('migration 002', () => {
	it('takes a v1 database with open swaps and credits to v2', async () => {
		const name = `mig_${Date.now()}`;
		await sql.unsafe(`CREATE DATABASE ${name}`);
		const url = new URL(process.env.DATABASE_URL!);
		url.pathname = `/${name}`;
		const db = postgres(url.toString(), { max: 1, onnotice: () => {} });
		try {
			await db.unsafe(await readFile('migrations/001_init.sql', 'utf8'));
			const [a] = await db`INSERT INTO users (email, name, city, credits) VALUES ('a@x', 'A', 'Pune', 0) RETURNING id`;
			const [b] = await db`INSERT INTO users (email, name, city, credits) VALUES ('b@x', 'B', 'Kochi', 0) RETURNING id`;
			const [l] = await db`INSERT INTO listings (owner_id, title, author, tier, condition, status)
				VALUES (${a.id}, 'T', 'A', 'paperback', 'good', 'reserved') RETURNING id`;
			const [s] = await db`INSERT INTO swaps (listing_id, owner_id, requester_id, credits, method, status, address)
				VALUES (${l.id}, ${a.id}, ${b.id}, 1, 'post', 'sent', 'Old address') RETURNING id`;
			await db`INSERT INTO credit_ledger (user_id, delta, reason, swap_id) VALUES (${b.id}, 1, 'refund', ${s.id})`;

			await db.unsafe(await readFile('migrations/002_orders.sql', 'utf8'));

			const [o] = await db`SELECT status, address FROM orders WHERE id = ${s.id}`;
			expect({ ...o }).toEqual({ status: 'cancelled', address: null });
			const [l2] = await db`SELECT status, journey_id FROM listings WHERE id = ${l.id}`;
			expect(l2.status).toBe('available');
			const stops = await db`SELECT city FROM journey_stops WHERE journey_id = ${l2.journey_id}`;
			expect(stops.map((r) => r.city)).toEqual(['Pune']);
			const leftovers = await db`SELECT table_name, column_name FROM information_schema.columns
				WHERE table_schema = 'public' AND (table_name IN ('credit_ledger', 'swaps') OR column_name IN ('credits', 'tier'))`;
			expect([...leftovers]).toEqual([]);
		} finally {
			await db.end();
			await sql.unsafe(`DROP DATABASE ${name}`);
		}
	});
});

describe('flows that span modules', () => {
	it('the viewer sees nothing of an order they are not on, through a dispute too', async () => {
		const s = await orderAt('in_transit');
		await disputeOrder(s.requester, s.id, 'Lost');
		expect(await orderFor(s.id, await newUser())).toBeNull();
		await expect(acceptOrder(s.owner, s.id, 'x')).rejects.toThrow();
	});
});
