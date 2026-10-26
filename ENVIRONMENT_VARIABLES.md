# Environment variables

Set these in **Netlify → Site configuration → Environment variables** (site `symphonious-starlight-a1d58b`). After any change, trigger a new deploy.
Nothing here is ever needed in the browser, and **no secret value is included in this ZIP**. For local testing copy `.env.example` to `.env` (git-ignored).

> **Deploy previews:** the checkout you screenshotted was a *deploy preview* URL (`6ade…--symphonious-starlight-a1d58b.netlify.app`). In Netlify each variable can be limited to certain "deploy contexts". If a variable is set only for *Production*, previews cannot see it. Tick **All deploy contexts** (or at least Production + Deploy Previews) while testing.

| Variable | Required? | Purpose | Public / Secret | Belongs in | How to obtain | Used for |
|---|---|---|---|---|---|---|
| `RAZORPAY_KEY_ID` | **Required** | Razorpay Key ID (`rzp_test_…` or `rzp_live_…`). Its prefix decides Test vs Live mode. Sent to the browser by `create-order` to open Checkout (it is public by design). | Public-safe, but set on the server | Netlify | Razorpay Dashboard → Account & Settings → API Keys → Generate Key (pick **Test Mode** or **Live Mode** with the toggle at the top) | Netlify, Razorpay |
| `RAZORPAY_KEY_SECRET` | **Required** | Creates orders and verifies payment signatures. Must be the secret *paired with the same mode's Key ID*. | **Secret** | Netlify only | Shown once when the key is generated (regenerate if lost) | Netlify, Razorpay |
| `RAZORPAY_WEBHOOK_SECRET` | Strongly recommended | Verifies webhook calls so payments still unlock if the buyer closes the tab. Without it every webhook is rejected (checkout still works). | **Secret** | Netlify only | Razorpay → Account & Settings → Webhooks → Add: URL `https://YOUR-SITE/.netlify/functions/razorpay-webhook`, events `payment.captured`, `order.paid`, `payment.failed`; choose your own secret string and paste the same one here | Netlify, Razorpay |
| `SUPABASE_URL` | **Required** | Project URL, e.g. `https://YOUR_PROJECT_REF.supabase.co` | Not secret, kept server-side | Netlify | Supabase → Project Settings → API → Project URL | Netlify, Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Lets the Netlify Functions write purchases/tokens/certificates (bypasses RLS). **Never** put it in any file in `public/` or in git. | **Secret** | Netlify only | Supabase → Project Settings → API → `service_role` / secret key | Netlify, Supabase |
| `SITE_URL` | Optional (recommended) | Public site address used in certificate QR codes / verification links and e-mailed links, e.g. `https://yourdomain.com`. If unset, Netlify's `URL` or the request host is used. | Public | Netlify | Your production domain | Netlify |
| `RESEND_API_KEY` | Optional | Enables e-mailing the course link + certificate PDF after payment (and "Access my course" e-mails). Without it the site works fully; the link is shown on the success page. | **Secret** | Netlify only | resend.com → API Keys (verify your sending domain first) | Netlify |
| `EMAIL_FROM` | Optional (needed with `RESEND_API_KEY`) | Sender, e.g. `Scale It Now <certificates@yourdomain.com>` | Not secret | Netlify | Your verified Resend sender | Netlify |
| `ACCESS_TOKEN_TTL_DAYS` | Optional | Days until a new course link expires. Empty = lifetime access (matches the "lifetime access" promise). | Public | Netlify | Choose a number | Netlify |
| `BUNNY_LIBRARY_ID`, `BUNNY_TOKEN_KEY` | Optional | Only if you host some videos on Bunny Stream instead of YouTube. | Library ID public; token key **Secret** | Netlify only | Bunny dashboard | Netlify |

Removed (no longer used): `SUPABASE_ANON_KEY`, `SUPPORT_EMAIL` (now fixed in `public/js/config.js`), `CERTIFICATE_REQUIRES_ALL_LESSONS`. You may delete them from Netlify. Do **not** set `SECRETS_SCAN_OMIT_KEYS` or `SECRETS_SCAN_ENABLED`.

## Test Mode vs Live Mode (do not mix)
1. **Test:** Razorpay dashboard in *Test Mode* → generate keys → `RAZORPAY_KEY_ID=rzp_test_…` + its secret. Create a Test-mode webhook and use *its* secret. Pay with Razorpay's test cards/UPI. The checkout and success pages show a yellow "Test mode" notice.
2. **Live:** complete Razorpay KYC → switch the dashboard to *Live Mode* → generate **new** keys → replace **all three** Razorpay variables (live Key ID, live secret, and the secret of a **separate Live-mode webhook**) → redeploy. Test and live keys/webhooks never work with each other (a mismatched pair gives error `razorpay_auth` in the function log).
3. Test purchases live in the same database. Before launch, delete them in Supabase (Table Editor → `purchases`; their tokens/certificates cascade) or filter on `rzp_mode = 'test'`.

## Diagnosing "Could not start payment"
Open `https://YOUR-SITE/.netlify/functions/health?deep=1`. It returns only true/false flags: which variables exist, Razorpay mode, whether Razorpay accepts the key pair, and whether the database tables exist. Details of any failure are in **Netlify → Logs → Functions → create-order** (each line has a `code` such as `config_razorpay`, `razorpay_auth`, `db_schema`).
