import { sql } from '$lib/server/db';
import { text } from '$lib/server/validate';

const PAGE = 48;

export const load = async ({ url }) => {
	const q = text(url.searchParams.get('q')?.slice(0, 100) ?? null, 100);
	const city = text(url.searchParams.get('city'), 60);
	const wanted = url.searchParams.get('condition');
	const condition = wanted === 'like_new' || wanted === 'good' || wanted === 'worn' ? wanted : null;
	const page = Math.max(1, Math.min(1000, Math.floor(Number(url.searchParams.get('page'))) || 1));

	const books = await sql`
		SELECT l.id, l.title, l.author, l.isbn, l.condition, u.city
		FROM listings l JOIN users u ON u.id = l.giver_id
		WHERE l.status = 'available' AND u.banned_at IS NULL
			${q ? sql`AND ${q} <% (l.title || ' ' || l.author)` : sql``}
			${city ? sql`AND lower(u.city) = lower(${city})` : sql``}
			${condition ? sql`AND l.condition = ${condition}` : sql``}
		ORDER BY ${q ? sql`word_similarity(${q}, l.title || ' ' || l.author) DESC,` : sql``} l.created_at DESC
		LIMIT ${PAGE + 1} OFFSET ${(page - 1) * PAGE}`;

	const cities = await sql`SELECT DISTINCT u.city FROM listings l JOIN users u ON u.id = l.giver_id
		WHERE l.status = 'available' ORDER BY u.city LIMIT 200`;

	return {
		books: books.slice(0, PAGE).map((b) => ({ ...b })),
		more: books.length > PAGE,
		cities: cities.map((c) => c.city as string),
		filters: { q, city, condition },
		page
	};
};
