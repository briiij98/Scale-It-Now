// Purchase lifecycle: idempotent payment confirmation, certificate issuance, passwordless access tokens.
const crypto = require("crypto");
const db = require("./supabase"), { dbError } = require("./supabase");
const { AppError } = require("./http");
const { PRICE_PAISE, CURRENCY } = require("./razorpay");
const { COURSE_TITLE } = require("./course");

const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,59}$/;        // printed on the certificate with standard PDF fonts: English letters only
const EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[A-Za-z]{2,}$/;
const cleanName = (s) => String(s || "").trim().replace(/\s+/g, " ");
const cleanEmail = (s) => String(s || "").trim().toLowerCase();
const isValidName = (s) => NAME_RE.test(cleanName(s));
const isValidEmail = (s) => { const e = cleanEmail(s); return e.length <= 254 && EMAIL_RE.test(e); };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const newCertId = () => `SIN-${new Date().getFullYear()}-` + Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");
const istDate = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_ACTIVE_TOKENS = 10;

// ---------- access tokens (256-bit random; only the SHA-256 hash is stored) ----------
async function issueToken(purchaseId) {
  const { data: existing, error: e0 } = await db().from("access_tokens").select("id").eq("purchase_id", purchaseId).is("revoked_at", null);
  if (e0) throw dbError(e0, "count tokens");
  if ((existing || []).length >= MAX_ACTIVE_TOKENS) throw new AppError("token_limit", 429, "Too many access links have been issued for this purchase. Please contact support.");
  const raw = crypto.randomBytes(32).toString("base64url"); // 43 chars
  const days = Number(process.env.ACCESS_TOKEN_TTL_DAYS);
  const expires_at = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null; // default: lifetime access
  const { error } = await db().from("access_tokens").insert({ purchase_id: purchaseId, token_hash: sha256(raw), expires_at });
  if (error) throw dbError(error, "insert token");
  return raw; // returned to the buyer once; never stored or logged
}

// Resolves "Authorization: Bearer <token>" to a live, paid purchase. Returns null for anything else.
async function purchaseFromToken(event) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!TOKEN_RE.test(token)) return null;
  const { data: t, error } = await db().from("access_tokens").select("*").eq("token_hash", sha256(token)).maybeSingle();
  if (error) throw dbError(error, "lookup token");
  if (!t || t.revoked_at || (t.expires_at && new Date(t.expires_at) <= new Date())) return null;
  const { data: p, error: e2 } = await db().from("purchases").select("*").eq("id", t.purchase_id).maybeSingle();
  if (e2) throw dbError(e2, "lookup purchase");
  if (!p || p.status !== "paid" || p.revoked_at) return null;
  db().from("access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id).then(() => {}, () => {}); // best effort
  return p;
}

// ---------- certificates ----------
// One certificate per purchase (UNIQUE purchase_id). Safe to call any number of times, concurrently.
async function ensureCertificate(purchase) {
  const get = async () => { const { data, error } = await db().from("certificates").select("*").eq("purchase_id", purchase.id).maybeSingle(); if (error) throw dbError(error, "read certificate"); return data; };
  let cert = await get();
  for (let i = 0; i < 5 && !cert; i++) {
    const { data, error } = await db().from("certificates").insert({
      cert_id: newCertId(), purchase_id: purchase.id, student_name: purchase.customer_name,
      course_title: COURSE_TITLE, completed_on: istDate(purchase.paid_at || new Date()),
    }).select().single();
    if (!error) cert = data;
    else if (error.code === "23505") cert = await get(); // another request won the race, or a cert_id clash (then retry)
    else throw dbError(error, "insert certificate");
  }
  if (!cert) throw new AppError("cert_failed", 500, "Your payment is confirmed but the certificate could not be created yet. Please use 'Access my course' in a minute, or contact support.");
  return cert;
}

// ---------- payment confirmation ----------
// IDEMPOTENT: callable from verify-payment AND the webhook, in any order, any number of times, concurrently.
// Only a payment that Razorpay itself reported for OUR order, with the exact amount and currency, can unlock anything.
async function confirmPurchase({ orderId, paymentId, amount, currency }) {
  if (amount !== PRICE_PAISE || currency !== CURRENCY) return { ok: false, reason: "amount_mismatch" };
  const { data: p, error } = await db().from("purchases").select("*").eq("razorpay_order_id", orderId).maybeSingle();
  if (error) throw dbError(error, "lookup purchase by order");
  if (!p) return { ok: false, reason: "unknown_order" };
  if (p.amount_paise !== amount || p.currency !== currency) return { ok: false, reason: "amount_mismatch" };
  if (p.status === "refunded" || p.revoked_at) return { ok: false, reason: "revoked" };
  if (p.razorpay_payment_id && p.razorpay_payment_id !== paymentId && p.status === "paid") return { ok: false, reason: "different_payment_already_recorded" };

  let purchase = p, firstTime = false;
  if (p.status !== "paid") {
    // Conditional update: exactly one caller can flip created/failed -> paid, so "first time" is race-free.
    const { data: rows, error: uErr } = await db().from("purchases")
      .update({ status: "paid", razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
      .eq("id", p.id).neq("status", "paid").select();
    if (uErr) throw dbError(uErr, "mark paid");
    if (rows && rows.length) { purchase = rows[0]; firstTime = true; }
    else { const { data: again } = await db().from("purchases").select("*").eq("id", p.id).maybeSingle(); purchase = again || p; }
  }
  const certificate = await ensureCertificate(purchase);
  return { ok: true, purchase, certificate, firstTime };
}

// A failed attempt never unlocks anything; it only labels the order (and can never overwrite a paid one).
async function markFailed(orderId) {
  await db().from("purchases").update({ status: "failed" }).eq("razorpay_order_id", orderId).eq("status", "created");
}

// The buyer's browser may receive its access token exactly once per purchase through the success callback.
// (Anyone else must use the e-mailed link or the "Access my course" recovery form.)
async function claimBrowserToken(purchase) {
  const { data: rows, error } = await db().from("purchases").update({ access_claimed_at: new Date().toISOString() }).eq("id", purchase.id).is("access_claimed_at", null).select();
  if (error) throw dbError(error, "claim token");
  if (!rows || !rows.length) return null;
  try { return await issueToken(purchase.id); }
  catch (e) { await db().from("purchases").update({ access_claimed_at: null }).eq("id", purchase.id); throw e; } // let the buyer retry
}

const maskEmail = (e) => { const [u, d] = String(e).split("@"); return u.slice(0, 1) + "***@" + d; };
module.exports = { cleanName, cleanEmail, isValidName, isValidEmail, sha256, issueToken, purchaseFromToken, ensureCertificate, confirmPurchase, markFailed, claimBrowserToken, maskEmail, TOKEN_RE, newCertId };
