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

In progress when saved:
3. Lead developer replacing the credit model with orders, Razorpay and courier in test mode, and the book
   journey; clean schema from scratch; removing all credit and swap terms. The working tree may be mid-rewrite,
   so run `npm run check` and `npm test` to see the real state. Do not assume this step finished.

To do:
4. Finish step 3 if interrupted. Grep case-insensitively for credit, ledger, tier and swap.
5. Retake screenshots.
6. QA and security testers run in parallel and try to break payments, refunds, permissions and privacy.
7. Fix findings, then final verification by the product owner.

Needed from the owner: Razorpay and Shiprocket/Delhivery accounts (own KYC), Google OAuth client, a durable
database for launch, a final name and domain.

Never verified so far: real Google sign-in, real email, Render deployment, real phone, PWA install, barcode scan.
Do not deploy until steps 3 to 7 pass. Local dev commands are in README.md.
