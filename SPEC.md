# OpenShelf — product spec v2

Brand: "OpenShelf" in copy, `openshelf` in code and package names. This is a working name and will likely
change, so user-facing copy reads it from one constant (`src/lib/brand.ts`), not hardcoded strings.
Tagline: "Every book deserves a next reader."

## V2 model (overrides everything about credits below)
Givers give a book they no longer use, free. The person who wants it pays a platform fee plus courier.
The point is the love of books; both sides should feel good. Competitors such as MyPustak already offer free
books for shipping, so the book's journey is what makes us different. Credits, tiers, starter credit, ledger,
holds and pair cap are removed.

- Flow: giver lists -> receiver requests and pays -> pickup booked from giver -> delivered -> receiver confirms.
- Platform fee is a constant, ₹39 to start. Courier charge is quoted per order. Local handover: fee only.
- Payments through Razorpay, courier booking through one provider, each behind one small module with a clearly
  labelled test mode while the owner's KYC accounts do not exist. Never charge real money in test mode.
- Payment before reservation is final: a verified payment webhook (signature checked, idempotent) confirms the
  order. Refund the full amount if the giver doesn't respond in 72h, pickup fails, or a dispute is upheld.
- Book journey: giver writes a short note to the next reader; receiver sends a thank-you back; each book shows
  its history (reader count and cities only, never names). A receiver can give the book onward and the journey
  continues. This is public and shareable.
- Anti-reseller: max 3 orders per user per calendar month.
- Keep the two-party contact privacy, address wipe, reports, bans, admin, disputes, sweep, rate limits.

Book exchange for India. Source idea: @uvichar_ reel, "PLEASE, someone build this in India".
You buy a book for ₹500, read it once, it sits on a shelf. Someone else wants that exact book.
List it, someone requests it, ship or hand it over, earn credits, spend credits on another book.
Audience: college students, working professionals, avid readers.

Objections from the reel's comments that the product must answer:
- "How do you determine a book's value?" -> flat tiers, never prices. See Credits.
- "I never give my books away" -> not our user. Don't chase them.
- "OLX exists" -> no haggling, no cash, no strangers' phone calls before a swap is agreed.

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
title/author with pg_trgm, filter by city and tier). Book `/books/[id]`. List a book `/list`
(ISBN typed or scanned using native BarcodeDetector when present, autofill through Open Library,
called server-side with a 4s timeout; manual entry always works). My shelf `/shelf`. Swaps `/swaps`
and `/swaps/[id]`. Profile `/me` (name, city, pincode, WhatsApp number, delete account).
Admin `/admin` (disputes, reports, ban). `/terms`, `/privacy`.

## Auth
Google sign-in only (authorization code flow with PKCE + state, using fetch, no auth library).
Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ORIGIN. Server-side sessions: random 32 bytes in an
HttpOnly, Secure, SameSite=Lax cookie; store only the SHA-256 hash in the DB; 30 day expiry.
A dev-only login route exists only when NODE_ENV !== 'production' AND DEV_LOGIN=1; it must be
impossible to reach in a production build. ADMIN_EMAILS env decides admins.
Profile (city, pincode, WhatsApp) is required before listing or requesting. WhatsApp number is
unique across users, normalised to +91 and 10 digits.

## Credits (the core; get this exactly right)
Tiers: `paperback` = 1 credit. `premium` = 2 credits (hardcover, or a textbook published in the last
5 years). Owner picks; older textbooks are paperback tier. Tier is shown on the card. No prices anywhere.
Starter: 1 credit, once per account, on the third book listed. Removing listings never re-grants it.
Credits are not money: no cash-out, no transfer, no purchase in v1.

Ledger: append-only `credit_ledger` (user_id, delta, reason, swap_id, created_at), never UPDATE or
DELETE (enforce with a trigger). `users.credits` is a cached balance with CHECK (credits >= 0), changed
only in the same transaction as a ledger insert. Unique index on (swap_id, reason, user_id) so each
event can apply only once. An invariant test: credits = SUM(delta) for every user.
All state changes in one transaction with row locks. Status transitions are guarded in SQL
(`UPDATE ... WHERE status = expected`), so concurrency and double-clicks are safe.

Swap states:
requested -> accepted | declined | cancelled | expired
accepted -> sent | cancelled | expired
sent -> received | disputed
disputed -> received | refunded

- Request: requester needs enough credits; hold (debit) at once; listing -> reserved. Listing can have
  only one open swap (partial unique index). Cannot request your own. Max 5 open requests per user.
- Owner has 72h to accept, else expired and refund, listing -> available.
- Decline/cancel before sent: refund, listing -> available.
- Accepted: owner has 5 days to mark sent, else expired and refund.
- Method chosen at request time: `handover` (local) or `post` (requester supplies address on accept;
  owner pays postage, this is what the credit pays for).
- Requester confirms received: owner earns the credits, listing -> gone. Auto-confirm 14 days after sent
  unless disputed.
- Disputed: admin resolves, pay owner (received) or refund requester (refunded). Exactly one.
- Anti-farming: credits earned from the same user pair are capped at 3 swaps per rolling 30 days; further
  swaps between them are refused at request time with a clear message.
Timers: an idempotent `sweep()` run hourly from setInterval in the server, guarded by a Postgres advisory
lock, and also unit-tested directly.

## Privacy and safety
Public pages show first name, city, tier, condition. Never pincode, full name, email, or WhatsApp.
WhatsApp deep link and address are visible only to the two parties, only from accepted onward.
Postal address lives on the swap and is wiped when the swap reaches a terminal state.
Report button on listings and users. Ban blocks sign-in and hides listings; open swaps get refunded.
Account delete: anonymises the user, removes listings, refunds open swaps, keeps ledger rows.
Terms must ban pirated copies and photocopies. Privacy page covers India's DPDP Act basics.
Rate limit sign-in, requests and listing creation (in-memory token bucket is fine, mark with a
`ponytail:` comment). Strict security headers including CSP. Rely on SvelteKit origin check for CSRF.
No user file uploads in v1 (covers come from Open Library URLs, allowlisted in CSP). Every server action
checks authN and authZ. Validate all input at the boundary.

## Notifications
`notify(user, subject, text)`: sends through Resend's HTTP API with fetch when RESEND_API_KEY is set,
otherwise logs. Fires on new request, accepted, declined, sent, received, dispute, expiry warning.

## Not in v1
Payments, memberships, transaction fees, delivery partners, chat, native apps, ratings beyond a count of
completed swaps. The money model from the reel (memberships + fees) comes after liquidity; leave no
scaffolding for it.

## Rules
Never fabricate activity. Seed data exists for local dev only; production shows real counts.
Performance budget: first load JS on `/books` under 60 KB gzip; server-rendered and usable without JS for
browse and read pages. Accessibility: keyboard, labels, contrast AA.
Design: warm, bookish, anti-generic. No emerald/indigo SaaS look, no emoji icons, no default anything.
Windows note: C:\Users\Shiva has a stray package.json and is a git repo; this project has its own git repo.
