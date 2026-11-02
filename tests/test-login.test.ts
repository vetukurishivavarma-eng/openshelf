import { afterEach, describe, expect, it } from 'vitest';
import { sql } from '../src/lib/server/db';
import { actions, load } from '../src/routes/test-login/+page.server';

const post = (email: string, password: string) => {
	const f = new FormData();
	f.set('email', email);
	f.set('password', password);
	const set: string[] = [];
	const event = {
		request: new Request('http://x', { method: 'POST', body: f }),
		getClientAddress: () => `10.0.0.${Math.random()}`,
		cookies: { set: (name: string) => set.push(name) }
	};
	return { set, run: () => (actions.default as Function)(event) };
};
const status = async (p: Promise<unknown>) => {
	try {
		const r = (await p) as { status?: number };
		return r?.status ?? 'ok';
	} catch (e) {
		return (e as { status: number }).status;
	}
};

afterEach(() => { delete process.env.TEST_LOGIN_PASSWORD; });

describe('test login', () => {
	it('does not exist unless a password is set', async () => {
		expect(await status(Promise.resolve().then(() => (load as Function)()))).toBe(404);
		expect(await status(post('a@b.co', '').run())).toBe(404);
	});

	it('refuses a wrong password and signs in with the right one', async () => {
		process.env.TEST_LOGIN_PASSWORD = 'correct horse';
		const email = `tl-${process.pid}-${Date.now()}@x.test`;
		const wrong = post(email, 'correct hors');
		expect(await status(wrong.run())).toBe(403);
		expect(wrong.set).toEqual([]);
		const right = post(email, 'correct horse');
		expect(await status(right.run())).toBe(303);
		expect(right.set.length).toBe(1);
		const [u] = await sql`SELECT google_sub FROM users WHERE email = ${email}`;
		expect(u.google_sub).toBe(`test:${email}`);
	});
});
