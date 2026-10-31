import { sql } from '$lib/server/db';

export const load = async () => {
	const [counts] = await sql<{ books: number; passed: number; readers: number }[]>`SELECT
		(SELECT count(*)::int FROM listings WHERE status = 'available') AS books,
		(SELECT count(*)::int FROM orders WHERE status = 'received') AS passed,
		(SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND banned_at IS NULL) AS readers`;
	return { counts: { ...counts } };
};
