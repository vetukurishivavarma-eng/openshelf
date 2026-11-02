# OpenShelf progress

## RESUME HERE (saved 2026-10-31)

Idea: givers give books free. Readers pay a ₹39 platform fee plus courier. Each book shows its journey
(note to the next reader, thank-you back, reader count and cities). Source of truth: SPEC.md, top section.
Owner instruction: build purely on the new idea. Nothing from the credit model may remain.

Working name OpenShelf, chosen by the owner and likely to change; lives in src/lib/brand.ts.
openshelf.com/.app/.in are all taken, so a final name or domain is needed before launch.

Done:
1. Core app (v1, credit model): sign-in, browse, listing, admin, security headers, PWA. 150 tests passed.
2. Design: library-card concept, icon set, landing page, screenshots in docs/screens (out of date after step 3).

3. Rebuilt on the new idea with a clean schema: 399 tests pass, check and build pass, full test-mode order over
   HTTP works. Razorpay and Shiprocket only tested against stubs; new order UI never seen in a browser.

4. Security test done: docs/security-report.md. Verdict: not ready for real money; H1-H3 are launch blockers.

5. QA done: docs/qa-report.md. Screens retaken in docs/screens.

6. MILESTONE 2026-11-01: all High and money/privacy Medium findings fixed. Product owner re-ran it: check 0
   errors, 446 tests pass, build passes. Exploits for H1-H3 and browser checks for QA Highs were run by the
   developer, not re-run independently. docs/security-report.md, docs/qa-report.md and docs/screens predate these
   fixes (their "OPEN" status is stale). Dev DB must be recreated: schema changed and UTF8 is now required.

7. DONE 2026-11-01: courier and handover orders walked as real users in Chromium (reader and giver, test mode):
   request, pay, accept, pickup or handover, delivered, received, thank-you, onward, dispute. No console errors,
   no failed requests, no sideways scroll at 360 or 1280. Order screens in docs/screens retaken and viewed; L12
   viewed and closed. Fixed: status crumb now matches the slip, dispute text addressed to the viewer, spacing
   under the action box, a flaky test helper (phone numbers collided between test files). 446 tests pass,
   3 runs in a row. Not walked in a browser: admin resolving a dispute, cancel, decline, expiry.

Partly open: M5 (is True-Client-IP safe on Render?), L1 (real fix needs phone verification), L4 (salt must never
rotate). L2 and log-out-everywhere have no tests.

If `npm test` hangs with no output: an interrupted run left a Postgres worker holding port 54331. Stop it.

To do:
8. Real-service testing, needs the owner's accounts: Razorpay sandbox (CSP hosts, inline styles, auto-capture),
   Shiprocket (API cancel may fail after AWB, sending every timeout to admin), Google, Resend, Render, a real phone.
9. Legal review of /terms and /privacy; add operator and grievance contact.
10. Final name and domain.

Needed from the owner: Razorpay and Shiprocket/Delhivery accounts (own KYC), Google OAuth client, a durable
database for launch, a final name and domain.

Never verified so far: real Google sign-in, real email, Render deployment, real phone, PWA install, barcode scan.
Do not deploy until step 8 passes. Local dev commands are in README.md.
