// Razorpay over fetch. Without keys it is a labelled test mode: no money moves, and test payments
// still run through handleWebhook so both modes share one code path.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql, tx, type Tx } from './db';
import { applyCapture } from './engine';
import { courierTestMode } from './courier';

const API = 'https://api.razorpay.com/v1';
const RETRY_AFTER_MINUTES = 15;
const MAX_ATTEMPTS = 10;
// Random per process, so nobody can forge a test webhook from a secret in the source.
const TEST_SECRET = randomBytes(32).toString('hex');

const env = () => ({
	id: process.env.RAZORPAY_KEY_ID,
	secret: process.env.RAZORPAY_KEY_SECRET,
	webhook: process.env.RAZORPAY_WEBHOOK_SECRET
});

export const paymentsTestMode = () => {
	const { id, secret, webhook } = env();
	return !(id && secret && webhook);
};

/** Runs at server start. A production build must never fall into test mode by accident. */
export function assertConfig(production: boolean) {
	const { id, secret, webhook } = env();
	if ((id || secret || webhook) && paymentsTestMode())
		throw new Error('Set all of RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET, or none.');
	if (!production) return;
	if (!process.env.SUB_HASH_SALT) throw new Error('SUB_HASH_SALT is required in production.');
	if ((paymentsTestMode() || courierTestMode()) && process.env.ALLOW_TEST_PAYMENTS !== '1')
		throw new Error('Refusing to start in test mode. Set the Razorpay and Shiprocket keys, or ALLOW_TEST_PAYMENTS=1.');
}

const auth = () => `Basic ${Buffer.from(`${env().id}:${env().secret}`).toString('base64')}`;

/** Amount comes from the order row, never from a client. Throws if Razorpay refuses. */
export async function createGatewayOrder(orderId: string, amountPaise: number): Promise<string> {
	if (paymentsTestMode()) return `test_order_${orderId}`;
	const res = await fetch(`${API}/orders`, {
		method: 'POST',
		headers: { authorization: auth(), 'content-type': 'application/json' },
		body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: orderId.slice(0, 40) }),
		signal: AbortSignal.timeout(8000)
	});
	if (!res.ok) throw new Error(`Razorpay orders ${res.status}`);
	return (await res.json()).id;
}

export function verifySignature(raw: string, signature: string | null) {
	if (!signature) return false;
	const secret = paymentsTestMode() ? TEST_SECRET : env().webhook!;
	const expected = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'));
	const given = Buffer.from(signature);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The status to answer the webhook with. Anything but 2xx makes Razorpay retry. */
export async function handleWebhook(raw: string, signature: string | null, eventId: string | null) {
	if (!verifySignature(raw, signature)) return 400;
	if (!eventId) return 400;
	let event: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
	try {
		event = JSON.parse(raw);
	} catch {
		return 400;
	}
	const kind = String(event.event);
	let orderId: string | null = null;
	await tx(async (t) => {
		// In the same transaction as the effect: a crash forgets both, so the retry still applies.
		const fresh = await t`INSERT INTO webhook_events (event_id, kind) VALUES (${eventId}, ${kind})
			ON CONFLICT DO NOTHING RETURNING event_id`;
		if (!fresh.length) return;
		if (kind === 'payment.captured' || kind === 'order.paid') {
			const p = event.payload?.payment?.entity;
			if (!p) return;
			orderId = await applyCapture(t, {
				gatewayOrderId: String(p.order_id),
				paymentId: String(p.id),
				amount: Number(p.amount),
				currency: String(p.currency)
			});
		} else if (kind === 'refund.processed' || kind === 'refund.failed') {
			const r = event.payload?.refund?.entity;
			const status = kind === 'refund.processed' ? 'processed' : 'failed';
			if (r) await t`UPDATE refunds SET status = ${status}, provider_refund_id = COALESCE(provider_refund_id, ${String(r.id)})
				WHERE payment_id = ${String(r.payment_id)} AND status <> 'processed'`;
		}
	});
	if (orderId) await flushRefunds(orderId);
	return 200;
}

/** Test mode's Pay button: a signed event through the real webhook path. */
export async function simulatePayment(order: { gateway_order_id: string; total_paise: number }, amount = order.total_paise) {
	if (!paymentsTestMode()) throw new Error('simulatePayment is test mode only');
	const raw = JSON.stringify({
		event: 'payment.captured',
		payload: {
			payment: {
				entity: { id: `test_pay_${randomUUID()}`, order_id: order.gateway_order_id, amount, currency: 'INR' }
			}
		}
	});
	const signature = createHmac('sha256', TEST_SECRET).update(raw).digest('hex');
	return handleWebhook(raw, signature, `test_evt_${randomUUID()}`);
}

/** Inside the state change's transaction. A second refund for one payment is a no-op by constraint. */
export async function queueRefund(
	t: Tx,
	r: { orderId: string; paymentId: string; amount: number; reason: string; testMode: boolean }
) {
	await t`INSERT INTO refunds (order_id, payment_id, amount_paise, reason, test_mode)
		VALUES (${r.orderId}, ${r.paymentId}, ${r.amount}, ${r.reason}, ${r.testMode})
		ON CONFLICT (payment_id) DO NOTHING`;
}

async function sendRefund(id: string) {
	// The claim stops two callers reaching the provider together; a crash is retried after a delay
	// and Razorpay's idempotency key absorbs a call that had in fact gone through.
	const [r] = await sql`UPDATE refunds SET status = 'processing', attempts = attempts + 1, attempted_at = now()
		WHERE id = ${id} AND attempts < ${MAX_ATTEMPTS} AND (status = 'pending'
			OR (status = 'processing' AND attempted_at < now() - make_interval(mins => ${RETRY_AFTER_MINUTES})))
		RETURNING id, payment_id, amount_paise, test_mode, attempts`;
	if (!r) return;
	try {
		let providerId = `test_rfnd_${r.id}`;
		if (!r.test_mode) {
			const res = await fetch(`${API}/payments/${r.payment_id}/refund`, {
				method: 'POST',
				headers: { authorization: auth(), 'content-type': 'application/json', 'X-Refund-Idempotency': r.id },
				body: JSON.stringify({ amount: r.amount_paise, speed: 'normal', receipt: r.id.slice(0, 40) }),
				signal: AbortSignal.timeout(8000)
			});
			if (!res.ok) throw new Error(`Razorpay refund ${res.status}`);
			providerId = (await res.json()).id;
		}
		// Guarded, so a refund.processed webhook that overtook this response is not downgraded.
		await sql`UPDATE refunds SET status = 'sent', provider_refund_id = ${providerId}
			WHERE id = ${r.id} AND status = 'processing'`;
	} catch (e) {
		console.error('[refund]', r.id, e);
		const next = r.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
		await sql`UPDATE refunds SET status = ${next} WHERE id = ${r.id} AND status = 'processing'`;
	}
}

/** After commit, for one order or (from sweep) everything outstanding. Never throws at the user. */
export async function flushRefunds(orderId?: string) {
	const due = await sql`SELECT id FROM refunds
		WHERE status IN ('pending', 'processing') ${orderId ? sql`AND order_id = ${orderId}` : sql``}`;
	for (const { id } of due) {
		try {
			await sendRefund(id);
		} catch (e) {
			console.error('[refund]', id, e);
		}
	}
}
