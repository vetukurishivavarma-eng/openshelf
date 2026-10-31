# OpenShelf

Every book deserves a next reader. Givers give books away free; a reader pays a ₹39 platform fee plus courier,
or the fee alone for a local handover. Each book keeps a public journey of reader count and cities.
`SPEC.md` is the source of truth. The name lives in `src/lib/brand.ts`.

SvelteKit 2, Svelte 5, TypeScript, PostgreSQL through `postgres` with raw SQL, adapter-node. Node 22.

## Run locally

```sh
npm install
cp .env.example .env
npm run db        # terminal 1: embedded Postgres on :54320, data in .pgdata
npm run migrate   # terminal 2
npm run seed      # dev data; refuses NODE_ENV=production and non-local databases
npm run dev       # http://localhost:5173
```

Sign in without Google at `http://localhost:5173/dev-login?email=asha@dev.local`
(also `rohan`, `meera`, `kabir`). This needs `DEV_LOGIN=1` and does nothing in a production build.
To use `/admin` locally, add the email to `ADMIN_EMAILS`.

## Test mode

With no Razorpay or Shiprocket keys the app runs in test mode, labelled on every page: "Test mode, no money
moves". Order pages get a test Pay button and courier controls. Test payments still go through the real
webhook handler, signed with a per-process random secret.

A production build refuses to start in test mode unless `ALLOW_TEST_PAYMENTS=1`. Half-set keys, and one
provider live with the other in test mode, are refused everywhere. When live keys appear, open test orders
are cancelled at startup; a test order never books a real courier.

## Check

```sh
npm run check
npm test          # starts its own embedded Postgres on :54331 in .pgtest
npm run build
```

`SEED=<n> npm test` replays a randomised run; the seed is printed with `--silent=false`.

## Production build locally

With `npm run db` running:

```sh
npm run build
npm run migrate
ORIGIN=http://localhost:3000 ALLOW_TEST_PAYMENTS=1 SUB_HASH_SALT=local npm start   # http://localhost:3000
```

The session cookie is `Secure`, so signing in over plain http works only on localhost.

## Deploy to Render

1. Push the repo, then create a Blueprint from `render.yaml` (web service and Postgres).
2. In Google Cloud, create an OAuth client with the redirect URI `https://<host>/auth/google/callback`.
3. Set `ORIGIN` (`https://<host>`, no trailing slash), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `ADMIN_EMAILS`, and optionally `RESEND_API_KEY` with `RESEND_FROM`.
4. Payments: set the three `RAZORPAY_*` keys and point a Razorpay webhook at `https://<host>/webhooks/razorpay`
   for `payment.captured`, `order.paid`, `refund.processed` and `refund.failed`.
5. Courier: set `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` and `SHIPROCKET_WEBHOOK_TOKEN`, and point a Shiprocket
   webhook at `https://<host>/webhooks/courier` with that token as its `x-api-key`.
6. Until the KYC accounts exist, set `ALLOW_TEST_PAYMENTS=1` instead of steps 4 and 5.

`npm start` does not migrate; run `npm run migrate` first, or use the Render start command, which does. The
sweep runs at start and every 5 minutes. Rate limits live in memory, so run a
single instance.

Never rotate `SUB_HASH_SALT`: bans and monthly counts on deleted accounts are keyed by it.

Razorpay's automatic capture is set per order in `createGatewayOrder`. The Checkout hosts in the CSP
(`svelte.config.js`) are not confirmed by Razorpay's public docs; test them in the sandbox before launch.

## Layout

- `migrations/`: numbered SQL, applied by `scripts/migrate.mjs`
- `src/lib/server/engine.ts`: listings, orders, journeys, ban/delete and sweep
- `src/lib/server/payments.ts`: Razorpay, webhook verification, the refund outbox, startup checks
- `src/lib/server/courier.ts`: quotes and pickup booking
- `src/app.css`: all shared styling; `src/lib/ui/`: shared components
- `tests/`: Vitest on real Postgres
