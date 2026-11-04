// Covers the two gaps left in PROGRESS.md: L2 (report / ISBN lookup limits) and "sign out everywhere".
import { describe, expect, it } from 'vitest';
import { startSession } from '../src/lib/server/auth';
import { sql } from '../src/lib/server/db';
import { actions as bookActions } from '../src/routes/books/[id]/+page.server';
import { actions as listActions } from '../src/routes/list/+page.server';
import { actions as meActions } from '../src/routes/me/+page.server';
import { newListing, newUser } from './helpers';

const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return new Request('http://x', { method: 'POST', body: f });
};
const locals = (id: string) => ({ user: { id } }) as unknown as App.Locals;
const statusOf = async (p: unknown) => {
	try {
		const r = (await p) as { status?: number };
		return r?.status ?? 200;
	} catch (e) {
		return (e as { status: number }).status;
	}
};

describe('L2: per-user limits', () => {
	it('stops reports after 10 an hour', async () => {
		const giver = await newUser('Giver');
		const reader = await newUser();
		const id = await newListing(giver);
		const report = () =>
			(bookActions.report as Function)({ request: form({ reason: 'spam' }), params: { id }, locals: locals(reader) });
		for (let i = 0; i < 10; i++) expect(await statusOf(report())).toBe(200);
		expect(await statusOf(report())).toBe(429);
		const [{ n }] = await sql`SELECT count(*)::int AS n FROM reports WHERE reporter_id = ${reader}`;
		expect(n).toBe(10);
	});

	it('stops ISBN lookups after 30 an hour, before calling Open Library', async () => {
		const reader = await newUser();
		const calls: string[] = [];
		const real = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			calls.push(String(url));
			return new Response('{}', { status: 404 });
		}) as typeof fetch;
		try {
			const lookup = () => (listActions.lookup as Function)({ request: form({ isbn: '9780140449136' }), locals: locals(reader) });
			for (let i = 0; i < 30; i++) expect(await statusOf(lookup())).toBe(200);
			const before = calls.length;
			expect(await statusOf(lookup())).toBe(429);
			expect(calls.length).toBe(before);
		} finally {
			globalThis.fetch = real;
		}
	});
});

describe('sign out everywhere', () => {
	it('ends every session of that user and no one else', async () => {
		const me = await newUser();
		const other = await newUser('Other');
		const jar = { set: () => {}, delete: () => {} } as never;
		await startSession(jar, me);
		await startSession(jar, me);
		await startSession(jar, other);
		const deleted: string[] = [];
		const cookies = { delete: (name: string) => deleted.push(name) };
		expect(await statusOf((meActions.everywhere as Function)({ locals: locals(me), cookies }))).toBe(303);
		const count = async (u: string) => (await sql`SELECT count(*)::int AS n FROM sessions WHERE user_id = ${u}`)[0].n;
		expect(await count(me)).toBe(0);
		expect(await count(other)).toBe(1);
		expect(deleted).toEqual(['session']);
	});
});
