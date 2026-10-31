// The adapter's handler behind a thin server, because its static files never reach hooks.server.ts.
import http from 'node:http';
import { handler } from '../build/handler.js';

const server = http.createServer((req, res) => {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	handler(req, res);
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '0.0.0.0', () =>
	console.log(`Listening on ${process.env.PORT ?? 3000}`)
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
