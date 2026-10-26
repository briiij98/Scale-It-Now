// Netlify build step (see netlify.toml). The browser needs NO secrets, so nothing is generated from environment variables.
// This guard FAILS the build if a server-side secret could end up in the published folder:
//   1) any secret environment variable's VALUE appears in public/ (the same check Netlify's scanner does, made explicit);
//   2) public/ contains key-shaped strings (Razorpay, Supabase service-role/secret, Resend) or secret variable names.
// It never disables or bypasses Netlify's secret scanning (do not set SECRETS_SCAN_OMIT_KEYS / SECRETS_SCAN_ENABLED).
const fs = require("fs"), path = require("path");
const SECRET_VARS = ["SUPABASE_SERVICE_ROLE_KEY", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RESEND_API_KEY", "BUNNY_TOKEN_KEY"];
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const root = path.join(__dirname, "..", "public");
let bad = 0; const fail = (m) => { bad++; console.error("[verify-public-build] FAIL " + m); };
const text = (f) => fs.readFileSync(f).toString("latin1");

for (const f of walk(root)) {
  if (!/\.(html|js|css|json|txt|svg|map)$/i.test(f)) continue;
  const src = text(f), rel = path.relative(path.join(root, ".."), f);
  for (const k of SECRET_VARS) { const v = (process.env[k] || "").trim(); if (v.length >= 8 && src.includes(v)) fail(`${rel} contains the VALUE of ${k}`); if (new RegExp("\\b" + k + "\\b").test(src)) fail(`${rel} mentions secret variable name ${k}`); }
  if (/rzp_(live|test)_[A-Za-z0-9]{8,}/.test(src)) fail(`${rel} contains a Razorpay key id (the key id is delivered by the create-order function, not hard-coded)`);
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(src)) fail(`${rel} contains a Supabase secret key`);
  if (/\bre_[A-Za-z0-9]{20,}\b/.test(src)) fail(`${rel} contains something shaped like a Resend API key`);
  for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g)) fail(`${rel} contains a JWT (no Supabase keys belong in public files)`);
}
if (bad) { console.error(`\n[verify-public-build] ${bad} problem(s): build stopped so no secret is published.`); process.exit(1); }
console.log(`[verify-public-build] OK: ${walk(root).length} public files checked, no secrets found.`);
