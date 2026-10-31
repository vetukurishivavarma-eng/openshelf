# OpenShelf security report (commit 4a825b5)

Verdict: payment verification, authZ and injection defences held. The serious problems are in the order
lifecycle and test/live mode mixing. Not ready for real money until H1-H3 are fixed; M1-M5 should follow.
Provider behaviour was simulated with a fetch stub. Status: all findings OPEN.

## High
- H1 Free book + full refund: delete the account after pickup is booked; the shipment is never cancelled.
  Ban and the 5-day timeout have the same gap. engine.ts closeAccount, pickupFailed; courier.ts has no cancel.
  Fix: add cancelShipment(), call after commit; block deletion at pickup_booked; if cancel fails, flag for admin.
- H2 Test-paid orders book real couriers after going live. engine.ts acceptOrder ignores o.test_mode.
  Fix: real courier only when !o.test_mode; cancel open test orders at live startup.
- H3 ALLOW_TEST_PAYMENTS permits half-live setups: real money with no shipment, or anyone spending the courier
  balance with no payment. Fix: assertConfig refuses when payment and courier modes differ.

## Medium
- M1 Handover: book in hand, cancel, full refund, cap untouched. Fix: reader cancel only before an agreed time,
  or fee non-refundable after accept; count those cancels toward the cap.
- M2 Monthly cap resets on delete and return. Fix: carry the count via deleted_sub_hash. WhatsApp is unverified,
  so the cap is only a speed bump without phone verification.
- M3 Missing courier scan refunds a shipped order; missing webhook token makes that universal. Fix: require
  SHIPROCKET_WEBHOOK_TOKEN with courier keys; query shipment status before a timeout refund.
- M4 Failed refunds are stranded; admin has no retry. Fix: admin retry action, alert on failure.
- M5 Rate limiter: spoofable IP if the header is client-controlled (confirm on Render), and buckets.clear() at
  50k keys resets all limits. Fix: evict oldest, or separate IP and user maps.
- M6 DPDP mismatch: delivery_pincode, dispute notes and report reasons survive deletion; banned users cannot
  erase. Fix: null them at terminal state/deletion, add banned-user erasure route, define retention.
- M7 Unpaid reservation griefing; 30-minute hold can last 90. Fix: 5-minute expiry sweep, tighter repeat limit.
- M8 Giver changes pincode after the quote. Fix: snapshot pincode on the order at quote time.

## Low
- L1 WhatsApp number oracle and squatting; L2 unmetered reports and ISBN lookups; L3 city is public free text;
  L4 rotating SUB_HASH_SALT lifts bans; L5 ban after delete-and-return misses the live session;
  L6 giver first name visible before payment; L7 WhatsApp visible indefinitely after received;
  L8 static files lack security headers; L9 no log out everywhere.

## Launch blocker (not security, not run on Render)
render.yaml runs npm ci with NODE_ENV=production, which likely omits vite. Fix: npm ci --include=dev.

## Held up
Webhook signature, replay, ordering, amount and currency checks; exactly-once refunds under parallel calls;
receipt-then-dispute; courier webhook auth; startup guard; IDOR and authZ across routes; OAuth PKCE/state and
sessions; dev-login; CSRF; XSS; SQLi; mass assignment; SSRF; secrets; no PII in logs.

## Not tested
Real browser, real provider payloads, Razorpay Checkout under our CSP, auto-capture setting, Render edge
behaviour, Postgres TLS, service worker, Resend, multi-instance, crash between refund call and DB write.
Full npm audit shows 6 low findings; SvelteKit enhanced-form advisory not assessed for reachability.
Exploit scripts: session scratchpad `sec\t2_free.mjs`, `sec\t2b_modes.mjs` (temporary location).
