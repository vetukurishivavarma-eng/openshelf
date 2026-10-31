import postgres from 'postgres';

export const sql = postgres(process.env.DATABASE_URL ?? '', { max: 10, onnotice: () => {} });

export type Tx = postgres.TransactionSql;

/** One transaction; re-runs on deadlock, which has already rolled everything back. */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return (await sql.begin(fn)) as T;
		} catch (e) {
			if ((e as { code?: string }).code !== '40P01' || attempt >= 3) throw e;
		}
	}
}
