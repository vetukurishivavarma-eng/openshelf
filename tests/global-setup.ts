import { rmSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';
import { migrate } from '../scripts/migrate.mjs';

const databaseDir = '.pgdata-test';
const port = 54321;

export default async function setup() {
	rmSync(databaseDir, { recursive: true, force: true });
	const pg = new EmbeddedPostgres({
		databaseDir,
		user: 'postgres',
		password: 'postgres',
		port,
		persistent: false,
		onLog: () => {}
	});
	await pg.initialise();
	await pg.start();
	await pg.createDatabase('openshelf_test');
	const url = `postgres://postgres:postgres@localhost:${port}/openshelf_test`;
	process.env.DATABASE_URL = url;
	process.env.NODE_ENV = 'test';
	await migrate(url);
	return () => pg.stop();
}
