const { json } = require("./_lib/http");
const { creds } = require("./_lib/razorpay");

// Owner diagnostics: open https://YOUR-SITE/.netlify/functions/health to see which settings are present.
// Returns only true/false flags and the Razorpay mode - never a value. Add ?deep=1 to also test the Razorpay credentials.
exports.handler = async (event) => {
  const has = (k) => !!(process.env[k] && String(process.env[k]).trim());
  let rzpMode = null, rzpProblem = null;
  try { rzpMode = creds().mode; } catch (e) { rzpProblem = e.code || "config"; }
  const out = {
    razorpay: { keyConfigured: has("RAZORPAY_KEY_ID") && has("RAZORPAY_KEY_SECRET"), mode: rzpMode, problem: rzpProblem, webhookSecretConfigured: has("RAZORPAY_WEBHOOK_SECRET") },
    supabase: { urlConfigured: has("SUPABASE_URL"), serviceKeyConfigured: has("SUPABASE_SERVICE_ROLE_KEY") },
    email: { configured: has("RESEND_API_KEY") && has("EMAIL_FROM") },
    siteUrl: has("SITE_URL") ? "set" : (has("URL") ? "netlify-default" : "from-request"),
  };
  if (((event.queryStringParameters || {}).deep) === "1" && rzpMode) {
    try {
      const { keyId, secret } = creds();
      const r = await fetch("https://api.razorpay.com/v1/orders?count=1", { headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64") } });
      out.razorpay.credentialsAccepted = r.ok; out.razorpay.apiStatus = r.status;
    } catch (e) { out.razorpay.credentialsAccepted = null; out.razorpay.apiStatus = "network_error"; }
    // Check every table AND column the purchase flow uses, so a half-migrated database is reported precisely.
    const need = {
      purchases: "id,razorpay_order_id,razorpay_payment_id,customer_name,customer_email,amount_paise,currency,status,rzp_mode,terms_version,terms_accepted_at,access_claimed_at,created_at,paid_at,revoked_at",
      access_tokens: "id,purchase_id,token_hash,created_at,expires_at,revoked_at,last_used_at",
      certificates: "id,cert_id,purchase_id,user_id,student_name,course_title,completed_on,issued_at",
    };
    const { scrub } = require("./_lib/http");
    out.supabase.tables = {};
    try {
      const sb = require("./_lib/supabase")();
      for (const [t, cols] of Object.entries(need)) {
        const { error } = await sb.from(t).select(cols).limit(1);
        out.supabase.tables[t] = error ? "PROBLEM: " + scrub(error.message).replace(/https?:\/\/[^\s]+/g, "<url>") : "ok";
      }
      out.supabase.tablesReady = Object.values(out.supabase.tables).every((v) => v === "ok");
    } catch (e) { out.supabase.tablesReady = false; out.supabase.problem = e.code || "error"; out.supabase.reason = scrub(e.message).replace(/https?:\/\/[^\s]+/g, "<url>"); }
  }
  return json(200, out);
};
