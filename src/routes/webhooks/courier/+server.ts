import { createHash, timingSafeEqual } from 'node:crypto';
import { courierEvent } from '$lib/server/engine';

const digest = (s: string) => createHash('sha256').update(s).digest();
const PICKED_UP = /PICKED UP|IN TRANSIT|OUT FOR DELIVERY|SHIPPED/;
const FAILED = /PICKUP EXCEPTION|CANCELED|CANCELLED|UNDELIVERED|RTO|LOST/;

export const POST = async ({ request }) => {
	const token = process.env.SHIPROCKET_WEBHOOK_TOKEN;
	const given = request.headers.get('x-api-key');
	if (!token || !given || !timingSafeEqual(digest(token), digest(given))) return new Response(null, { status: 401 });

	const body = await request.json().catch(() => null);
	const status = String(body?.current_status ?? '').toUpperCase();
	const kind = status === 'DELIVERED' ? 'delivered' : FAILED.test(status) ? 'failed' : PICKED_UP.test(status) ? 'picked_up' : null;
	if (kind && body?.shipment_id) await courierEvent(String(body.shipment_id), kind);
	return new Response(null, { status: 200 });
};
