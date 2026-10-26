# Test report

Run on 2026-10-26 in a sandbox with **no network access**. Nothing below used real Razorpay, Supabase or Resend credentials, and **no real or test-mode transaction was made**.

Legend: **auto** = real code, fully automated. **mock** = real code against a *fake Razorpay/Resend* I wrote, so it proves our logic, not Razorpay's behaviour.

## Backend suite (`npm test`) — 28/28 passed
Real function handlers, in-memory fake database (models the UNIQUE constraints and conditional updates in the migration).

| # | Check | Type | Result |
|---|---|---|---|
| 1 | Build guard + structure + secret scan succeed | auto | PASS |
| 2 | No login/signup/password/email-confirmation anywhere in the customer flow | auto | PASS |
| 3 | Checkout validates name and email (UI markup + server) | auto | PASS |
| 4 | Order creation is exactly 999900 paise INR; browser amount ignored; public key id only | mock | PASS |
| 4.1 | Double-click / repeat create-order reuses the open order (no duplicate orders) | mock | PASS |
| 5 | Missing credentials give clear SERVER-side errors and a safe customer message | auto | PASS |
| 5.1 | Razorpay API failures (bad credentials, network, outage) are handled gracefully | mock | PASS |
| 5.2 | Database not migrated yet -> clear server hint, safe customer message | auto | PASS |
| 5.3 | Server logs contain no secrets, tokens or e-mail addresses | auto | PASS |
| 6 | Invalid payment signatures are rejected; nothing unlocked | auto | PASS |
| 7 | Wrong amount / currency / order are rejected (checkout AND webhook paths) | mock | PASS |
| 8 | Failed, cancelled, pending and authorized payments | mock | PASS |
| 9 | Unverified payments never produce a certificate or an access token | auto | PASS |
| 10 | Duplicate/concurrent callbacks (verify x5 + webhook x3) -> ONE paid purchase, ONE certificate, ONE browser token | mock | PASS |
| 10.1 | Webhook first, then browser: buyer still gets exactly one browser token | mock | PASS |
| 11 | Verified purchasers get course access (16 lessons) and lesson player URLs | auto | PASS |
| 12 | Certificate PDF contains the purchaser's name, course, date, unique ID and verification URL; says enrollment, not completion | auto | PASS |
| 13 | Certificate IDs are unique, well-formed and verifiable; revoked ones are invalid | auto | PASS |
| 13.1 | Cert-ID race: two simultaneous issuances for one purchase give one certificate | auto | PASS |
| 14 | Customers cannot reach other customers' purchases by changing tokens, URLs or parameters | auto | PASS |
| 14.1 | Only a HASH of each token is stored; raw tokens exist nowhere server-side | auto | PASS |
| 14.2 | Recovery without an account: needs e-mail + payment ID; wrong details get nothing | auto | PASS |
| 14.3 | Optional e-mail: first confirmation sends ONE e-mail with link + certificate; recovery e-mails and reveals nothing | mock | PASS |
| 15 | Public files contain no server-side secrets, keys or secret variable names | auto | PASS |
| 15.1 | health endpoint reveals only flags, never values | auto | PASS |
| 16 | The 16 lessons, titles, descriptions and YouTube configuration are preserved byte-for-byte from the supplied ZIP | auto | PASS |
| 16.1 | Landing page: honest copy (no fake discount, scarcity, counters, reviews) and working Buy buttons | auto | PASS |
| 17 | Every Netlify Function loads, exports a handler and rejects wrong HTTP methods | auto | PASS |

## Headless-browser smoke test (`python3 test/browser/e2e.py`) — 21/21 passed
Real pages in Chromium + real function handlers; the Razorpay popup is a **stub** that returns a correctly signed success/failure.

- PASS — landing: Buy Course buttons go to checkout
- PASS — landing: no login/signup links, no fake discount
- PASS — checkout: Pay disabled until terms ticked
- PASS — checkout: empty form shows name error and no order
- PASS — checkout: bad email rejected
- PASS — checkout: cancelled payment shows message, page stays, no access
- PASS — checkout: Razorpay opened with 999900 INR and public key id
- PASS — success: shows Payment Successful / Your Course Is Ready / Start Learning / Download Your Certificate
- PASS — success: shows purchaser name and course
- PASS — success: token never in the address bar
- PASS — success: certificate downloads as a real PDF
- PASS — success: private return link shown
- PASS — lessons: all 16 listed and navigation works
- PASS — lessons: video notice shown when no YouTube ID configured
- PASS — lessons: locked without a purchase link
- PASS — success page without token redirects to Access my course
- PASS — lessons: forged localStorage token does NOT unlock
- PASS — access link on another device opens course; fragment removed
- PASS — recovery: wrong payment ID refused
- PASS — checkout: failed payment shows error and grants nothing
- PASS — no uncaught JS errors on any page

## Also run
`npm run check` (structure: all files, every link/anchor, no auth pages, 16 lessons) — OK. `scripts/check-secrets.js` — OK. `scripts/verify-public-build.js` (the Netlify build command) — OK, and the suite proves it fails the build when a secret value is placed in `public/`.

## Mapping to your 17 checks
1→#1, 2→#2, 3→#3, 4→#4/4.1, 5→#5–5.3, 6→#6, 7→#7, 8→#8, 9→#9, 10→#10/10.1, 11→#11, 12→#12, 13→#13/13.1, 14→#14–14.3, 15→#15/15.1, 16→#16/16.1, 17→#17.

## NOT tested / remaining manual steps
- **Real Razorpay Checkout** (UPI/cards/netbanking), real signatures from Razorpay, the real webhook delivery, and Razorpay's actual API responses. Do a Test-mode purchase, then one small Live payment.
- **Real Supabase**: `SUPABASE_MIGRATION.sql` was not executed against a live Postgres here (SQL syntax reviewed by hand only). Run it and then open `/.netlify/functions/health?deep=1`.
- **Real e-mail** through Resend (optional) — only a mock was exercised.
- **Netlify build/deploy** itself and function bundling with esbuild; the `qrcode` and `@supabase/supabase-js` packages were not installable offline, so QR rendering was not exercised (the verification URL is printed on the PDF when `qrcode` is absent; with it installed a QR is added). Run `npm install` locally and `npm test` once.
- **Root cause of the original error** could not be confirmed without your Netlify logs. Candidates, all of which the old code reported with the same message: Razorpay variables missing/mismatched, `SUPABASE_SERVICE_ROLE_KEY` missing, the `payments` table not matching, or variables scoped away from the *deploy preview* you screenshotted. The new code reports a specific code per cause in the function log and via `health?deep=1`.
- **YouTube**: all 16 IDs in the supplied `data/youtube-ids.json` are empty; embedding could not be tested with real videos (the embed path is unit-tested with a sample ID).
- No rate limiting on `recover-access` beyond the high-entropy payment ID being required; consider Netlify/Cloudflare rate limits.
- Accessibility was built in (labels, `aria-live`, focus rings, keyboard-only form) but no screen-reader audit was done.
