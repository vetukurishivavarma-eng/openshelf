import { sql } from './db';

async function mail(to: string, subject: string, text: string) {
	const key = process.env.RESEND_API_KEY;
	if (!key) return false;
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
		body: JSON.stringify({ from: process.env.RESEND_FROM, to, subject, text }),
		signal: AbortSignal.timeout(5000)
	});
	if (!res.ok) console.error('[notify] Resend', res.status);
	return true;
}

/** Never throws and callers do not await it: mail must not fail or slow an order. */
export async function notify(userId: string, subject: string, text: string) {
	try {
		const [user] = await sql`SELECT email FROM users WHERE id = ${userId} AND deleted_at IS NULL`;
		if (user?.email && !(await mail(user.email, subject, text))) console.log(`[notify] ${userId}: ${subject}`);
	} catch (e) {
		console.error('[notify]', e);
	}
}

/** For what a person has to act on: stuck refunds and orders waiting on a decision. */
export async function alertAdmins(subject: string, text: string) {
	console.error(`[alert] ${subject}: ${text}`);
	for (const to of (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean))
		await mail(to, subject, text).catch((e) => console.error('[notify]', e));
}
