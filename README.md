# Scale It Now Academy

Course site for **Digital Marketing Fundamentals** (₹9,999, 16 lessons). Static frontend in `public/`, Netlify Functions in `netlify/functions/`, Supabase for records, Razorpay for payment.

Flow: landing → Buy Course → name + email → Razorpay → server-verified payment → instant certificate + course access. No registration, password or email confirmation. Access is a private link (`/access.html#t=…`, 256-bit token, only its SHA-256 hash stored).

- Setup: `README_DEPLOY.md`, `ENVIRONMENT_VARIABLES.md`, `SUPABASE_MIGRATION.sql`
- Tests: `npm test` (backend, fake DB + fake Razorpay), `python3 test/browser/e2e.py` (headless browser), `npm run check`
- Results: `TEST_REPORT.md`
