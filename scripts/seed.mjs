// Local dev data only.
import postgres from 'postgres';

if (process.env.NODE_ENV === 'production') {
	console.error('Refusing to seed: NODE_ENV=production');
	process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
	console.error('Refusing to seed: DATABASE_URL is not a local database');
	process.exit(1);
}

const readers = [
	['Asha Rao', 'Bengaluru', '560001', '+919000000001'],
	['Rohan Mehta', 'Mumbai', '400001', '+919000000002'],
	['Meera Iyer', 'Chennai', '600001', '+919000000003'],
	['Kabir Khan', 'Delhi', '110001', '+919000000004']
];
const books = [
	['The God of Small Things', 'Arundhati Roy', '9780006550686', 'good'],
	['Midnight’s Children', 'Salman Rushdie', '9780099578512', 'worn'],
	['A Suitable Boy', 'Vikram Seth', '9780060786526', 'like_new'],
	['The White Tiger', 'Aravind Adiga', '9781416562603', 'good'],
	['Train to Pakistan', 'Khushwant Singh', '9780143065883', 'good'],
	['Malgudi Days', 'R. K. Narayan', '9780143039655', 'worn'],
	['Introduction to Algorithms', 'Cormen et al.', '9780262046305', 'good'],
	['The Palace of Illusions', 'Chitra Banerjee Divakaruni', '9780307275257', 'like_new'],
	['Sapiens', 'Yuval Noah Harari', '9780099590088', 'good'],
	['Gitanjali', 'Rabindranath Tagore', null, 'worn'],
	['The Inheritance of Loss', 'Kiran Desai', '9780141027289', 'good'],
	['Concepts of Physics', 'H. C. Verma', null, 'good']
];

const sql = postgres(url, { max: 1, onnotice: () => {} });
const [{ n }] = await sql`SELECT count(*)::int AS n FROM users WHERE google_sub LIKE 'dev:%@dev.local'`;
if (n) {
	console.log('Already seeded.');
	await sql.end();
	process.exit(0);
}

await sql.begin(async (t) => {
	const ids = [];
	for (const [name, city, pincode, whatsapp] of readers) {
		const email = `${name.split(' ')[0].toLowerCase()}@dev.local`;
		const [u] = await t`INSERT INTO users (google_sub, email, name, city, pincode, whatsapp)
			VALUES (${`dev:${email}`}, ${email}, ${name}, ${city}, ${pincode}, ${whatsapp}) RETURNING id`;
		ids.push(u.id);
	}
	for (const [i, [title, author, isbn, condition]] of books.entries()) {
		const [l] = await t`INSERT INTO listings (giver_id, title, author, isbn, condition, note)
			VALUES (${ids[i % ids.length]}, ${title}, ${author}, ${isbn}, ${condition}, 'Read it slowly. It rewards you.')
			RETURNING journey_id`;
		await t`INSERT INTO journey_stops (journey_id, city) VALUES (${l.journey_id}, ${readers[i % ids.length][1]})`;
	}
});
console.log(`Seeded ${readers.length} readers and ${books.length} books. Sign in at /dev-login?email=asha@dev.local`);
await sql.end();
