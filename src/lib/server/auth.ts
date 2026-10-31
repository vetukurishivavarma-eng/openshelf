import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { sql } from './db';

const COOKIE = 'session';
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export type SessionUser = {
	id: string;
	name: string;
	email: string;
	city: string | null;
	pincode: string | null;
	whatsapp: string | null;
	isAdmin: boolean;
};

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function isAdmin(email: string) {
	const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase());
	return admins.includes(email.toLowerCase());
}

export async function startSession(cookies: Cookies, userId: string) {
	const token = randomToken();
	await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
		VALUES (${hash(token)}, ${userId}, now() + interval '30 days')`;
	cookies.set(COOKIE, token, { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge: THIRTY_DAYS });
}

export async function endAllSessions(cookies: Cookies, userId: string) {
	await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
	cookies.delete(COOKIE, { path: '/' });
}

export async function endSession(cookies: Cookies) {
	const token = cookies.get(COOKIE);
	if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hash(token)}`;
	cookies.delete(COOKIE, { path: '/' });
}

export async function sessionUser(cookies: Cookies): Promise<SessionUser | null> {
	const token = cookies.get(COOKIE);
	if (!token) return null;
	const [u] = await sql`SELECT u.id, u.name, u.email, u.city, u.pincode, u.whatsapp, u.google_sub
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ${hash(token)} AND s.expires_at > now()
			AND u.banned_at IS NULL AND u.deleted_at IS NULL`;
	if (!u) return null;
	// A ban can land on a deleted account after the same Google account has come back.
	const { google_sub, ...user } = u;
	if (google_sub && (await sql`SELECT 1 FROM users WHERE deleted_sub_hash = ${subHash(google_sub)} AND banned_at IS NOT NULL`).length) return null;
	return { ...user, isAdmin: isAdmin(u.email) } as SessionUser;
}

/** Salted, so the retained value cannot be matched against a list of Google ids. */
export const subHash = (sub: string) =>
	createHmac('sha256', process.env.SUB_HASH_SALT ?? 'dev-only-salt').update(sub).digest('hex');

/** Returns the user id, or null when the account is banned, including a deleted account that was. */
export async function upsertGoogleUser(sub: string, email: string, name: string) {
	const banned = await sql`SELECT 1 FROM users WHERE deleted_sub_hash = ${subHash(sub)} AND banned_at IS NOT NULL`;
	if (banned.length) return null;
	const [u] = await sql`INSERT INTO users (google_sub, email, name) VALUES (${sub}, ${email}, ${name})
		ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email
		RETURNING id, banned_at`;
	return u.banned_at ? null : (u.id as string);
}

const ERASE_MINUTES = 15;
const eraseSig = (body: string) => createHmac('sha256', process.env.SUB_HASH_SALT ?? 'dev-only-salt').update(`erase:${body}`).digest('hex');

/** A banned user cannot sign in, but must still be able to erase their data. Google proved who they are. */
export async function bannedAccount(sub: string) {
	const [u] = await sql`SELECT id FROM users WHERE google_sub = ${sub} AND banned_at IS NOT NULL AND deleted_at IS NULL`;
	if (!u) return null;
	const body = `${u.id}.${Date.now() + ERASE_MINUTES * 60_000}`;
	return `${body}.${eraseSig(body)}`;
}

export function erasableUser(token: string | undefined) {
	const [id, expires, sig] = token?.split('.') ?? [];
	if (!sig || Number(expires) < Date.now()) return null;
	const a = Buffer.from(sig);
	const b = Buffer.from(eraseSig(`${id}.${expires}`));
	return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
