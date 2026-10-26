const { verifyWebhookSignature } = require("./_lib/razorpay");
const { confirmPurchase, markFailed } = require("./_lib/purchase");
const { notifyBuyer } = require("./_lib/notify");

// Razorpay Dashboard > Webhooks URL:  https://YOUR-SITE/.netlify/functions/razorpay-webhook
// Events to tick: payment.captured, order.paid, payment.failed.  Test and Live mode have SEPARATE webhooks and secrets.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  // The signature is computed over the EXACT raw body, so verify before parsing.
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
  const h = event.headers || {};
  const sig = h["x-razorpay-signature"] || h["X-Razorpay-Signature"];
  if (!verifyWebhookSignature(raw, sig)) { console.warn(JSON.stringify({ fn: "razorpay-webhook", code: "bad_signature_or_no_secret" })); return { statusCode: 400, body: "Invalid signature" }; }
  try {
    const evt = JSON.parse(raw);
    const p = evt.payload && evt.payload.payment && evt.payload.payment.entity;
    if ((evt.event === "payment.captured" || evt.event === "order.paid") && p && p.order_id) {
      const r = await confirmPurchase({ orderId: p.order_id, paymentId: p.id, amount: p.amount, currency: p.currency });
      if (!r.ok) console.warn(JSON.stringify({ fn: "razorpay-webhook", code: "not_applied", reason: r.reason }));
      else if (r.firstTime) await notifyBuyer(event, r);
    } else if (evt.event === "payment.failed" && p && p.order_id) {
      await markFailed(p.order_id);
    }
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error(JSON.stringify({ fn: "razorpay-webhook", code: e.code || "error", reason: String(e.message).slice(0, 200) }));
    return { statusCode: 500, body: "error" }; // Razorpay retries on non-2xx
  }
};
