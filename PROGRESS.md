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

In progress:
6. Lead developer fixing every finding in docs/security-report.md and docs/qa-report.md. Check with
   `git log` and `npm test` how far it got; findings are not fixed unless the tests prove it.

To do:
7. Final verification by the product owner, retest of the High items.
8. Real-service testing, which needs the owner's accounts.

Needed from the owner: Razorpay and Shiprocket/Delhivery accounts (own KYC), Google OAuth client, a durable
database for launch, a final name and domain.

Never verified so far: real Google sign-in, real email, Render deployment, real phone, PWA install, barcode scan.
Do not deploy until steps 3 to 7 pass. Local dev commands are in README.md.
