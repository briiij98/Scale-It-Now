# Deploying the updated Scale It Now Academy (existing Netlify project)

I could not access your GitHub, Netlify, Supabase or Razorpay dashboards, so **none of the steps below have been done for you**.

## 1. Database (once)
Supabase → your Supabase project → SQL Editor → paste all of `SUPABASE_MIGRATION.sql` → Run. It is additive and re-runnable; nothing is dropped, RLS stays on, and the new tables have no browser access at all. (`supabase/schema.sql` is the same file.)

## 2. Environment variables
Follow `ENVIRONMENT_VARIABLES.md`. Minimum: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Use **Test** Razorpay keys first.

## 3. Push the code
Unzip over your local clone of `briij98/Scale-It-Now` (keep `.git`), then:
```
git add -A && git commit -m "No-registration checkout, verified Razorpay payments, instant certificate" && git push
```
Make sure Netlify builds the branch you pushed (Site configuration → Build & deploy → Branches). Build command and publish folder come from `netlify.toml` (`node scripts/verify-public-build.js`, `public`). If your Netlify UI has its own build command, clear it so `netlify.toml` applies. If you previously set `SECRETS_SCAN_OMIT_KEYS`, delete it.

## 4. Razorpay webhook
Dashboard (Test mode first) → Webhooks → URL `https://YOUR-SITE/.netlify/functions/razorpay-webhook`, events `payment.captured`, `order.paid`, `payment.failed`, secret = `RAZORPAY_WEBHOOK_SECRET`. Set payment capture to **Automatic** (the code also captures "authorized" payments if you keep manual).

## 5. Check
1. `/.netlify/functions/health?deep=1` → everything `true`.
2. Make a Test-mode purchase end to end (name + email → pay → success page → download certificate → Start Learning). Open the private link in another browser.
3. Verify the certificate at `/verify.html`.

## 6. YouTube lessons — action needed
`data/youtube-ids.json` in the ZIP you supplied has **all 16 `youtube` fields empty**, so I had nothing to preserve and did not invent IDs. Lessons currently show "video not available yet". Paste each lesson's YouTube link or 11-character ID into that file (run `npm run videos:status` to check), commit and push. Unlisted videos are embeddable but not access-controlled; anyone with the video link can watch.

## 7. Go live
Switch all three Razorpay variables to Live values (see ENVIRONMENT_VARIABLES.md), delete test purchases, redeploy, and do one small real payment yourself.

## Revoking access / refunds
Supabase → `purchases` → set `status = 'refunded'` (or fill `revoked_at`). All links stop working and the certificate verifies as invalid.

## Notes
- Terms and Privacy pages were edited to match the no-account flow; have them reviewed by whoever advises you on legal text.
- The old ₹49,000 "original price", "80% OFF", Diwali/limited-time wording, reviews section and learner counters were removed as unsupported claims. Add them back only if true.
- Hero facts like "3 Hours" and "Intermediate" were left as supplied; please confirm they are accurate.
- Old login-era tables remain in Supabase, unused.
