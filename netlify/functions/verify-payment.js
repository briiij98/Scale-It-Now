const db = require("./_lib/supabase"), { dbError } = require("./_lib/supabase");
const { json, fail, parseBody, siteUrl, AppError } = require("./_lib/http");
const { verifyCheckoutSignature, fetchPayment, capturePayment, PRICE_PAISE, CURRENCY } = require("./_lib/razorpay");
const { confirmPurchase, markFailed, claimBrowserToken, issueToken } = require("./_lib/purchase");
const { notifyBuyer } = require("./_lib/notify");

const ID_RE = { order: /^order_[A-Za-z0-9]{6,40}$/, payment: /^pay_[A-Za-z0-9]{6,40}$/ };

// Called by the browser after Razorpay Checkout says "success". The browser's word is NOT trusted: we check the HMAC signature
// and then ask Razorpay directly for the payment. Safe to call repeatedly (idempotent).
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const b = parseBody(event);
    const orderId = b.razorpay_order_id, paymentId = b.razorpay_payment_id, sig = b.razorpay_signature;
    if (!ID_RE.order.test(orderId || "") || !ID_RE.payment.test(paymentId || "") || typeof sig !== "string" || !sig) throw new AppError("missing_payment_details", 400, "Missing payment details.");
    if (!verifyCheckoutSignature(orderId, paymentId, sig)) throw new AppError("bad_signature", 400, "We could not verify this payment (invalid signature). If money was deducted, contact support with your payment reference.");

    const { data: purchase, error } = await db().from("purchases").select("*").eq("razorpay_order_id", orderId).maybeSingle();
    if (error) throw dbError(error, "lookup order");
    if (!purchase) throw new AppError("unknown_order", 404, "We could not find this order. If money was deducted, contact support with your payment reference.");

    let p = await fetchPayment(paymentId);
    if (p.order_id !== orderId) throw new AppError("payment_order_mismatch", 400, "This payment does not belong to this order.");
    if (p.amount !== PRICE_PAISE || p.currency !== CURRENCY || purchase.amount_paise !== p.amount) throw new AppError("amount_mismatch", 400, "The paid amount does not match the course price. Please contact support.", `amount/currency mismatch: ${p.amount} ${p.currency}`);
    if (p.status === "authorized") p = await capturePayment(paymentId, PRICE_PAISE, CURRENCY); // accounts set to manual capture
    if (p.status === "failed") { await markFailed(orderId); return json(402, { status: "failed", error: "The payment did not go through. You have not been charged for the course. Please try again." }); }
    if (p.status !== "captured") return json(202, { status: "pending", message: "Your payment is still being confirmed." }); // webhook / retry will finish it

    const r = await confirmPurchase({ orderId, paymentId, amount: p.amount, currency: p.currency });
    if (!r.ok) throw new AppError("not_confirmed", 400, "This payment could not be confirmed. Please contact support with your payment reference.", "confirm refused: " + r.reason);

    const token = await claimBrowserToken(r.purchase);           // null if this purchase's browser token was already handed out
    if (r.firstTime) await notifyBuyer(event, r);                 // optional e-mail, never blocks or fails the purchase
    return json(200, { status: "paid", token, tokenAlreadyIssued: !token, certificateId: r.certificate.cert_id, name: r.purchase.customer_name });
  } catch (e) { return fail("verify-payment", e); }
};
