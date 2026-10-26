const crypto = require("crypto");
const { AppError } = require("./http");
const PRICE_PAISE = 999900; // Rs 9,999 - fixed on the server, never read from the browser
const CURRENCY = "INR";

// Returns { keyId, secret, mode } or throws a config error that names the missing variable in the SERVER LOG only.
function creds() {
  const keyId = (process.env.RAZORPAY_KEY_ID || "").trim(), secret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const missing = [!keyId && "RAZORPAY_KEY_ID", !secret && "RAZORPAY_KEY_SECRET"].filter(Boolean);
  if (missing.length) throw new AppError("config_razorpay", 503, "Online payment is temporarily unavailable. Please contact support.", "Missing environment variable(s): " + missing.join(", "));
  const m = /^rzp_(test|live)_[A-Za-z0-9]+$/.exec(keyId);
  if (!m) throw new AppError("config_razorpay", 503, "Online payment is temporarily unavailable. Please contact support.", "RAZORPAY_KEY_ID must look like rzp_test_xxx or rzp_live_xxx (the Key ID, not the secret, and no spaces/quotes)");
  return { keyId, secret, mode: m[1] };
}
const mode = () => creds().mode;

async function rzp(path, options = {}) {
  const { keyId, secret } = creds();
  let res;
  try {
    res = await fetch("https://api.razorpay.com/v1" + path, {
      ...options,
      headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${secret}`).toString("base64"), "Content-Type": "application/json" },
    });
  } catch (e) {
    throw new AppError("razorpay_network", 502, "We could not reach the payment provider. Please check your connection and try again.", "network error calling Razorpay: " + e.message);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (data && data.error && data.error.description) || "no description";
    if (res.status === 401) throw new AppError("razorpay_auth", 503, "Online payment is temporarily unavailable. Please contact support.", "Razorpay rejected the API credentials (401). Check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are a matching pair from the same mode (test/live).");
    if (res.status >= 500) throw new AppError("razorpay_unavailable", 502, "The payment provider is not responding. Please try again in a few minutes.", `Razorpay ${res.status}: ${d}`);
    throw new AppError("razorpay_rejected", 502, "The payment provider could not start this payment. Please try again or contact support.", `Razorpay ${res.status}: ${d}`);
  }
  return data;
}
const createOrder = (receipt, notes) =>
  rzp("/orders", { method: "POST", body: JSON.stringify({ amount: PRICE_PAISE, currency: CURRENCY, receipt, notes }) });
const fetchPayment = (id) => rzp("/payments/" + encodeURIComponent(id));
const capturePayment = (id, amount, currency) => rzp(`/payments/${encodeURIComponent(id)}/capture`, { method: "POST", body: JSON.stringify({ amount, currency }) });

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""), "utf8"), y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");
// Checkout success signature: HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)
const verifyCheckoutSignature = (orderId, paymentId, signature) =>
  safeEqual(hmac(creds().secret, `${orderId}|${paymentId}`), signature);
// Webhook signature: HMAC_SHA256(raw request body, WEBHOOK_SECRET). Without the secret, every webhook is rejected.
const verifyWebhookSignature = (rawBody, signature) =>
  !!process.env.RAZORPAY_WEBHOOK_SECRET && safeEqual(hmac(process.env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature);

module.exports = { PRICE_PAISE, CURRENCY, creds, mode, createOrder, fetchPayment, capturePayment, verifyCheckoutSignature, verifyWebhookSignature };
