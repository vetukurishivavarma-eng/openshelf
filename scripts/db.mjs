// Local dev Postgres, data in .pgdata. Leave running in its own terminal.
import { existsSync } from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';

const databaseDir = '.pgdata';
const fresh = !existsSync(`${databaseDir}/PG_VERSION`);
const pg = new EmbeddedPostgres({
	databaseDir,
	user: 'postgres',
	password: 'postgres',
	port: 54320,
	persistent: true,
	initdbFlags: ['--encoding=UTF8', '--locale=C'],
	onLog: () => {}
});
if (fresh) await pg.initialise();
await pg.start();
await pg.createDatabase('openshelf').catch(() => {}); // Already there on later runs.
console.log('Postgres ready: postgres://postgres:postgres@localhost:54320/openshelf');

const stop = () => pg.stop().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
