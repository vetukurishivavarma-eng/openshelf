# OpenShelf

Every book deserves a next reader. A book-giving community for India; the app still runs the v1 credit engine until the v2 swap. `SPEC.md` is the source of truth.

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
(also `rohan`, `meera`, `kabir`). This needs `DEV_LOGIN=1` and does not exist in a production build.
To use `/admin` locally, add the email to `ADMIN_EMAILS`.

## Check

```sh
npm run check
npm test          # starts its own embedded Postgres on :54321 in .pgdata-test
npm run build
```

`SEED=<n> npm test` replays a randomised run; the seed is printed with `--silent=false`.

## Production build locally

With `npm run db` running:

```sh
npm run build
ORIGIN=http://localhost:3000 npm start   # http://localhost:3000
```

The session cookie is `Secure`, so signing in over plain http works only on localhost.

## Deploy to Render

1. Push the repo, then create a Blueprint from `render.yaml` (web service and Postgres).
2. In Google Cloud, create an OAuth client with the redirect URI `https://<host>/auth/google/callback`.
3. Set `ORIGIN` (`https://<host>`, no trailing slash), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `ADMIN_EMAILS`, and optionally `RESEND_API_KEY` with `RESEND_FROM`.

Migrations run on every start. The sweep runs at start and hourly. Rate limits live in memory, so run a
single instance.

## Layout

- `migrations/`: numbered SQL, applied by `scripts/migrate.mjs`
- `src/lib/server/engine.ts`: credits, listings, swaps, ban/delete and sweep
- `src/lib/brand.ts`: product name and tagline, read by every page and the manifest
- `src/app.css`: all shared styling
- `tests/`: Vitest on real Postgres
