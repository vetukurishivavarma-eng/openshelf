# OpenShelf progress

## RESUME HERE (saved 2026-11-04)

2026-11-04: test deploy + APK.
- Render (workspace "Appilication Dev", Singapore, FREE): web `openshelf` srv-dblmofh5efls73e83eug =
  https://openshelf-y68z.onrender.com (deploys origin main), DB `openshelf-db` dpg-dblmnsm1egvs73b2fc1g-a
  (free, EXPIRES 2026-12-04). Env set: NODE_VERSION 22, NODE_ENV, ADDRESS_HEADER=True-Client-IP,
  ALLOW_TEST_PAYMENTS=1, TEST_LOGIN_PASSWORD, SUB_HASH_SALT, ADMIN_EMAILS=admin@openshelf.test, ORIGIN.
  **MISSING: DATABASE_URL** (Render MCP can't read DB credentials; owner pastes the Internal Database URL).
  After it's live: check M5 (send a fake True-Client-IP header; Render's edge must overwrite it).
- android-shell/: Capacitor 8.5.3 wrapper loading the Render URL (icon/splash from static/, back = page back).
  Signed with C:/Users/Shiva/openshelf-keystore (NOT in git; copy keystore.properties to android-shell/android/).
  Build: cd android-shell && npm run apk. APK -> Downloads/openshelf-1.0.apk (vc1, verified). Not yet on GitHub
  releases (needs owner OK). Known limit: Google sign-in is blocked inside WebViews -> needs a Custom Tab flow
  before real Google login works in the app.
- tests/limits-sessions.test.ts: L2 + sign-out-everywhere now covered. 451 tests pass, check 0 errors.

## Earlier (saved 2026-11-02)

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

8a. DONE 2026-11-02: the remaining flows walked as real users in Chromium (test mode, 360 and 1280): reader cancels
   unpaid and paid, giver declines, giver cancels an agreed handover (reader has no cancel button), reader
   disputes, admin upholds and rejects disputes, unpaid order expires after 30 min and paid-unanswered after 72 h
   (rows backdated, startup sweep). All passed, no console errors, no 5xx, no sideways scroll. Refunds sit at
   "sent" in test mode (only the real Razorpay webhook moves them to "processed"; expected). Fixed: an upheld
   dispute told the reader the money goes back "to the reader"; now "to you". Walk script was in the session
   scratchpad, not kept.

8b. Added /test-login (commit after 7fd1c94): password sign-in for a TEST deployment with no Google OAuth client.
   On only when TEST_LOGIN_PASSWORD is set; /auth/google redirects there when GOOGLE_CLIENT_ID is unset.
   Anyone with the password can sign in as any email, admins included. Delete the route and unset the var before
   launch (marked ponytail:). 448 tests pass, check 0 errors, build passes.

Repo: github.com/vetukurishivavarma-eng/openshelf, local branch wip/openshelf pushes to origin main.

NEXT (owner chose 2026-11-02): Render FREE tier (free web + free Postgres, deleted after 30 days, fine for testing),
ALLOW_TEST_PAYMENTS=1, TEST_LOGIN_PASSWORD set, no Google/Razorpay/Shiprocket yet. render.yaml still says paid
plans (starter + basic-256mb): create the services by hand or edit the plans. Then an APK "like Specskart": a
native shell (Capacitor, own icon and splash, no browser bar) loading the Render URL, released on GitHub. NOT an
Expo rewrite (owner chose the shell). The owner said they will do their part later.

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
