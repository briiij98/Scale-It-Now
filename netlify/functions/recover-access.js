const db = require("./_lib/supabase"), { dbError } = require("./_lib/supabase");
const { json, fail, parseBody, siteUrl, AppError } = require("./_lib/http");
const { cleanEmail, isValidEmail, issueToken, ensureCertificate } = require("./_lib/purchase");
const email = require("./_lib/email");
const { renderCertificate } = require("./_lib/certificate");
const { SUPPORT } = require("./_lib/notify");
const { COURSE_TITLE } = require("./_lib/course");

// "Access my course" without an account. The buyer proves ownership with BOTH the e-mail used at checkout AND the Razorpay
// payment ID (pay_...) from their receipt / payment confirmation. Both must match one paid purchase.
//  - If e-mail delivery is configured, a fresh private link is e-mailed and the response is identical whether or not a match exists
//    (so the form cannot be used to discover who bought).
//  - Otherwise the new link is returned on the page (the payment ID acts as the second secret).
// Previously issued links keep working; ask support to revoke them if one was shared by mistake.
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const b = parseBody(event);
    const addr = cleanEmail(b.email), payId = String(b.paymentId || "").trim();
    if (!isValidEmail(addr)) throw new AppError("invalid_email", 400, "Please enter the email address you used at checkout.");
    if (!/^pay_[A-Za-z0-9]{6,40}$/.test(payId)) throw new AppError("invalid_payment_id", 400, "Please enter your Razorpay payment ID (it starts with \"pay_\"). You can find it in your payment confirmation or receipt.");

    const { data: p, error } = await db().from("purchases").select("*").eq("razorpay_payment_id", payId).eq("customer_email", addr).eq("status", "paid").maybeSingle();
    if (error) throw dbError(error, "recover lookup");
    const live = p && !p.revoked_at;
    const generic = { sent: true, message: "If these details match a purchase, we have emailed your private course link." };

    if (email.isConfigured()) {
      if (live) {
        const base = siteUrl(event), token = await issueToken(p.id), cert = await ensureCertificate(p);
        const verifyUrl = `${base}/verify.html?id=${cert.cert_id}`;
        const pdf = await renderCertificate({ name: cert.student_name, course: cert.course_title, issuedOn: cert.completed_on, certId: cert.cert_id, verifyUrl });
        const m = email.purchaseEmail({ name: p.customer_name, course: COURSE_TITLE, accessUrl: `${base}/access.html#t=${token}`, certId: cert.cert_id, verifyUrl, supportEmail: SUPPORT });
        await email.send({ to: p.customer_email, ...m, attachments: [{ filename: `${cert.cert_id}.pdf`, content: Buffer.from(pdf).toString("base64") }] });
      }
      return json(200, generic);
    }
    if (!live) throw new AppError("no_match", 404, "We could not find a purchase with that email and payment ID. Please check both and try again, or contact support.");
    const token = await issueToken(p.id);
    return json(200, { sent: false, token, message: "Verified. Your private course link is ready." });
  } catch (e) { return fail("recover-access", e); }
};
