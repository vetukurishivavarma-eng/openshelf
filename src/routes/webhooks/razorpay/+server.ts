import { handleWebhook } from '$lib/server/payments';

// The raw text, not parsed JSON: the signature covers these exact bytes.
export const POST = async ({ request }) => {
	const status = await handleWebhook(
		await request.text(),
		request.headers.get('x-razorpay-signature'),
		request.headers.get('x-razorpay-event-id')
	);
	return new Response(null, { status });
};
