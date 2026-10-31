# OpenShelf QA report (commit 4a825b5, Chromium headless)

Verdict: full lifecycle works, including money paths, cap, ban, delete and no-JS. Not ready: three High bugs.
Status: all findings OPEN. Screens in docs/screens contain QA data on purpose.

## High
- H1 Second press on Continue (slow network, 150ms+ gap) creates the order, then shows "no longer available"
  with no link to it. src/routes/books/[id]/+page.svelte:71. No submit lock or idempotency.
- H2 Second press on "Give this book" creates duplicate listings. src/routes/list/+page.svelte:80, engine.ts:121.
- H3 Long or unspaced titles break page width, up to 5189px overflow. src/app.css:46: headings override
  overflow-wrap. Affects book, order, /books, /shelf.

## Medium
- M1 Failed order form wipes input and shows the error below the fold. books/[id]/+page.server.ts:39, +page.svelte:38.
- M2 Text typed before hydration is erased: value= inputs in list:66-67, me:19-29, books:25.
- M3 Local dev DB is WIN1252, Hindi/Telugu/emoji give 500. scripts/db.mjs:6, add --encoding=UTF8; confirm Render UTF-8.
- M4 delivery_pincode not wiped at terminal states or deletion, contradicting /privacy. engine.ts:60-65, 431-450.
- M5 No notification when in-transit order becomes disputed by courier failure or the 21-day sweep; on-its-way
  text omits the rule. engine.ts:335, 502; orders/[id]/+page.svelte:38.
- M6 Reader cancelling an unpaid order notifies the giver and exposes it. engine.ts:300, orders/+page.server.ts:6-9.
- M7 Back after ordering says reserved for another reader. books/[id]/+page.svelte:48-49.
- M8 ISBN not looked up is dropped; note and title lost on Look up. list/+page.svelte:52, 65.
- M9 Banned giver's in-order listing stays public. engine.ts:434.
- M10 Slip ticks Delivered on an undelivered dispute; refunded path drops delivered steps. orders/[id]/+page.svelte:64-65.
- M11 Local handover has no locality check; landing says "Nearby?". books/[id]/+page.svelte:59, +page.svelte:65.

## Low
- L1 Stale next-step text after thank-you and give onward. orders/[id]/+page.svelte:48.
- L2 /list says only the receiving reader sees the note, but it shows once paid, before accept. engine.ts:417.
- L3 Role wording: orders/[id]:44,56,69; books/[id]:82; engine.ts:455; orders/+page.svelte:33.
- L4 Raw `post` in admin:23; "with Former"; "Fee ₹39+ courier" spacing orders/[id]:248; handover "Fee ₹39 = ₹39".
- L5 "Remove listing" on a gone listing errors. admin:69.
- L6 /list loses note on server error (list server:50); /me reverts edits; wrong whitespace address message (orders/[id] server:49).
- L7 Past deadlines stay actionable until the hourly sweep.
- L8 Query over 100 chars shows all books (books server:7); ?page=99999 shows the empty-site message.
- L9 No-JS refresh re-POSTs. Redirect after POST. orders/[id] server:108.
- L10 Courier warning tells the giver to act when they can only wait. engine.ts:532.
- L11 One CSP console error per load from Kit's announcer.
- L12 Stamp covers author on cover (app.css:219); journey touches Sign-in at 360px; gone listing shows "You pay ₹39".
- L13 seed says Already seeded with zero books; README wrong that npm start migrates; stale comment app.css:317.

## Could not test
Real Razorpay Checkout, Shiprocket, Google, email; phones (barcode, install prompt); screen readers; Render
encoding; 429 screens. About a dozen of 164 screens were viewed by eye; the rest had automated scans only.
