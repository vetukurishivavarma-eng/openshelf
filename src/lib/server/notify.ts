import { sql } from './db';

/** Never throws and callers do not await it: mail must not fail or slow an order. */
export async function notify(userId: string, subject: string, text: string) {
	try {
		const [user] = await sql`SELECT email FROM users WHERE id = ${userId} AND deleted_at IS NULL`;
		if (!user?.email) return;
		const key = process.env.RESEND_API_KEY;
		if (!key) {
			console.log(`[notify] ${userId}: ${subject}`);
			return;
		}
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
			body: JSON.stringify({ from: process.env.RESEND_FROM, to: user.email, subject, text }),
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) console.error('[notify] Resend', res.status);
	} catch (e) {
		console.error('[notify]', e);
	}
}
