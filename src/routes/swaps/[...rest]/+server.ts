import { redirect } from '@sveltejs/kit';

// Old links, including ones already in people's email.
export const GET = ({ params }) => redirect(308, `/orders/${params.rest}`.replace(/\/$/, ''));
