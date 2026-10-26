const crypto = require("crypto");
const db = require("./_lib/supabase"), { dbError } = require("./_lib/supabase");
const { json, fail, parseBody, AppError } = require("./_lib/http");
const { createOrder, creds, PRICE_PAISE, CURRENCY } = require("./_lib/razorpay");
const { cleanName, cleanEmail, isValidName, isValidEmail } = require("./_lib/purchase");
const { TERMS_VERSION } = require("./_lib/course");

const REUSE_WINDOW_MS = 15 * 60 * 1000; // an unpaid order for the same buyer is reused, so double clicks never pile up orders

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const b = parseBody(event);
    const name = cleanName(b.name), email = cleanEmail(b.email);
    // The browser is not trusted: everything is validated again here. The amount is NEVER read from the request.
    if (!isValidName(name)) throw new AppError("invalid_name", 400, "Please enter your full name using English letters (it is printed on your certificate).");
    if (!isValidEmail(email)) throw new AppError("invalid_email", 400, "Please enter a valid email address.");
    if (b.acceptedTerms !== true || b.termsVersion !== TERMS_VERSION) throw new AppError("terms_required", 400, "Please read and accept the Terms & Conditions to continue.");
    const { keyId, mode } = creds(); // throws a clear config error if the Razorpay variables are missing/malformed

    const { data: paid, error: pErr } = await db().from("purchases").select("id").eq("customer_email", email).eq("status", "paid").limit(1);
    if (pErr) throw dbError(pErr, "check existing purchase");
    if (paid && paid.length) throw new AppError("already_purchased", 409, "This email already has the course. Use \"Access my course\" to get your link again.");

    const cutoff = new Date(Date.now() - REUSE_WINDOW_MS).toISOString();
    const { data: open, error: oErr } = await db().from("purchases").select("*").eq("customer_email", email).eq("status", "created").eq("rzp_mode", mode).gte("created_at", cutoff).order("created_at", { ascending: false }).limit(1);
    if (oErr) throw dbError(oErr, "look for open order");
    let orderId, reused = false;
    if (open && open.length && open[0].customer_name === name) { orderId = open[0].razorpay_order_id; reused = true; }
    else {
      const receipt = "sin_" + crypto.randomBytes(8).toString("hex"); // <= 40 chars
      const terms_accepted_at = new Date().toISOString();
      // Terms acceptance is also stored on the Razorpay order as a second, independent record. No secrets or contact details in notes.
      const order = await createOrder(receipt, { terms_version: TERMS_VERSION, terms_accepted_at, course: "digital-marketing-fundamentals" });
      if (!order || !order.id || order.amount !== PRICE_PAISE || order.currency !== CURRENCY) throw new AppError("razorpay_bad_order", 502, "The payment provider returned an unexpected order. Please try again.", "order response mismatch");
      const { error } = await db().from("purchases").insert({
        razorpay_order_id: order.id, customer_name: name, customer_email: email, amount_paise: PRICE_PAISE, currency: CURRENCY,
        status: "created", rzp_mode: mode, terms_version: TERMS_VERSION, terms_accepted_at,
      });
      if (error) throw dbError(error, "save order");
      orderId = order.id;
    }
    return json(200, { keyId, orderId, amount: PRICE_PAISE, currency: CURRENCY, name, email, mode, reused }); // keyId is the PUBLIC key id only
  } catch (e) { return fail("create-order", e); }
};
