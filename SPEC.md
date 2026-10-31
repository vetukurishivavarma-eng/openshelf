# OpenShelf — product spec

Brand: "OpenShelf" in copy, `openshelf` in code and package names. This is a working name and will likely
change, so user-facing copy reads it from one constant (`src/lib/brand.ts`), not hardcoded strings.
Tagline: "Every book deserves a next reader."

## The idea
Givers give a book they no longer use, free. The reader who wants it pays a platform fee plus courier.
The point is the love of books; both sides should feel good. Competitors such as MyPustak already offer free
books for shipping, so the book's journey is what makes us different.

Book giving for India. Source idea: @uvichar_ reel, "PLEASE, someone build this in India".
You buy a book for ₹500, read it once, it sits on a shelf. Someone else wants that exact book.
Audience: college students, working professionals, avid readers.

- "I never give my books away" -> not our user. Don't chase them.
- "OLX exists" -> no haggling, no book prices, no strangers' phone calls before an order is confirmed.

## Orders
- Flow: giver lists -> reader requests and pays -> pickup booked from giver -> delivered -> reader confirms.
- Platform fee is a constant, ₹39 to start. Courier charge is quoted per order. Local handover: fee only.
  Money is stored as integer paise. Client-supplied prices are never trusted.
- Payments through Razorpay, courier booking through one provider, each behind one small module with a clearly
  labelled test mode while the owner's KYC accounts do not exist. Never charge real money in test mode.
  A production build refuses to start in test mode unless ALLOW_TEST_PAYMENTS=1.
- Payment before reservation is final: a verified payment webhook (signature checked, idempotent, amount
  verified against the order) confirms the order.
- Refund the full amount, exactly once, if the giver doesn't respond in 72h, pickup fails, or a dispute is upheld.
- States: requested -> paid -> pickup_booked -> in_transit -> delivered -> received, plus declined, cancelled,
  expired, disputed, refunded. A local handover skips the courier and in_transit.
- All state changes in one transaction with row locks. Status transitions are guarded in SQL
  (`UPDATE ... WHERE status = expected`), so concurrency and double-clicks are safe.
- A listing can have only one open order (partial unique index). You cannot order your own book.
- Anti-reseller: max 3 orders per user per calendar month, enforced race-safely.
- Timers: an idempotent `sweep()` run hourly from setInterval in the server, guarded by a Postgres advisory
  lock, and also tested directly.

## Book journey
The giver writes a short note to the next reader; the reader sends a thank-you back. Both are plain text,
length-limited, escaped and reportable. Each book shows its history (reader count and cities only, never names).
A reader can give the book onward, which relists the same book and continues its journey. This is public and
shareable.

## Stack (decided)
SvelteKit 2 + Svelte 5 + TypeScript, adapter-node. PostgreSQL via `postgres` (postgres.js), raw SQL,
plain numbered .sql migrations run by a tiny script. No ORM. No CSS framework. PWA (manifest + small
service worker for the app shell only). Fonts self-hosted through @fontsource packages.
Local dev/test database: `embedded-postgres` devDependency with its own data dir inside the project
(gitignored). Do NOT touch the machine's Windows postgres service or other projects' credentials.
Tests: vitest, against real Postgres. Node 22. npm.

Keep dependencies minimal. Prefer platform features (BarcodeDetector, <dialog>, CSS, fetch).

## Screens
Landing `/` (signed out: the pitch, how it works, real live counts only). Browse `/books` (search by
title/author with pg_trgm, filter by city and condition). Book `/books/[id]`. Give a book `/list`
(ISBN typed or scanned using native BarcodeDetector when present, autofill through Open Library,
called server-side with a 4s timeout; manual entry always works). My shelf `/shelf`. Orders `/orders`
and `/orders/[id]`. Profile `/me` (name, city, pincode, WhatsApp number, delete account).
Admin `/admin` (disputes, reports, ban). `/terms`, `/privacy`.

## Auth
Google sign-in only (authorization code flow with PKCE + state, using fetch, no auth library).
Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ORIGIN. Server-side sessions: random 32 bytes in an
HttpOnly, Secure, SameSite=Lax cookie; store only the SHA-256 hash in the DB; 30 day expiry.
A dev-only login route exists only when NODE_ENV !== 'production' AND DEV_LOGIN=1; it must be
impossible to reach in a production build. ADMIN_EMAILS env decides admins.
Profile (city, pincode, WhatsApp) is required before listing or requesting. WhatsApp number is
unique across users, normalised to +91 and 10 digits.

## Privacy and safety
Public pages show the book, its condition and city. Never a name, pincode, email, or WhatsApp.
The WhatsApp deep link is visible only to the two parties, only once the giver accepts.
Addresses live on the order and are wiped when it reaches a terminal state.
Report button on listings, users, notes and thank-yous. Ban blocks sign-in and hides listings; orders that
have not left the giver are refunded. Account delete: anonymises the user, removes listings, refunds those
same orders, and keeps a salted hash of the Google sub so that a ban on the account still holds.
Terms must ban pirated copies and photocopies. Privacy page covers India's DPDP Act basics and names the
payment and courier processors.
Rate limit sign-in, requests and listing creation (in-memory token bucket is fine, mark with a
`ponytail:` comment). Strict security headers including CSP. Rely on SvelteKit origin check for CSRF.
No user file uploads (covers come from Open Library URLs, allowlisted in CSP). Every server action
checks authN and authZ. Validate all input at the boundary.

## Notifications
`notify(user, subject, text)`: sends through Resend's HTTP API with fetch when RESEND_API_KEY is set,
otherwise logs. Fires on paid, accepted, declined, in transit, delivered, received, dispute, refund, expiry warning.

## Not built
Memberships, chat, native apps, ratings. Leave no scaffolding for them.

## Rules
Never fabricate activity. Seed data exists for local dev only; production shows real counts.
Performance budget: first load JS on `/books` under 60 KB gzip; server-rendered and usable without JS for
browse and read pages. Accessibility: keyboard, labels, contrast AA.
Design: warm, bookish, anti-generic. No emerald/indigo SaaS look, no emoji icons, no default anything.
Windows note: C:\Users\Shiva has a stray package.json and is a git repo; this project has its own git repo.
