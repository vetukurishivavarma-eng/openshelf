/** The platform fee. Server-side prices start here; the UI shows the same number. */
export const FEE_PAISE = 3900;
export const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;
export const CONDITION_LABEL: Record<string, string> = {
	like_new: 'Like new',
	good: 'Good',
	worn: 'Well read'
};
export const coverUrl = (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
export const ORDER_STATUS: Record<string, string> = {
	requested: 'Awaiting payment',
	paid: 'Paid',
	pickup_booked: 'Accepted',
	in_transit: 'On its way',
	delivered: 'Delivered',
	disputed: 'In dispute',
	received: 'Completed',
	declined: 'Declined',
	cancelled: 'Cancelled',
	expired: 'Expired',
	refunded: 'Refunded'
};
export const REFUND_STATUS: Record<string, string> = {
	pending: 'Refund queued',
	processing: 'Refund queued',
	sent: 'Refund sent',
	processed: 'Refund completed',
	failed: 'Refund needs attention'
};

// Fixed to IST so the server render and the browser agree on the date.
const IST = { timeZone: 'Asia/Kolkata' } as const;
export const fmtDate = (d: Date | string) =>
	new Date(d).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDeadline = (d: Date) =>
	d.toLocaleString('en-IN', { ...IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
