// Applies migrations/*.sql in filename order, each once, each in a transaction.
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

const dir = new URL('../migrations/', import.meta.url);

/** @param {string} url */
export async function migrate(url) {
	const sql = postgres(url, { max: 1, onnotice: () => {} });
	try {
		const [{ server_encoding: encoding }] = await sql`SHOW server_encoding`;
		if (encoding !== 'UTF8') throw new Error(`Database encoding is ${encoding}; readers write in Hindi and Telugu, so it must be UTF8.`);
		await sql`SELECT pg_advisory_lock(727001)`;
		await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
		const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));
		for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
			if (done.has(name)) continue;
			const text = await readFile(new URL(name, dir), 'utf8');
			await sql.begin(async (tx) => {
				await tx.unsafe(text);
				await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
			});
			console.log('applied', name);
		}
	} finally {
		await sql.end();
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	await migrate(process.env.DATABASE_URL);
}
