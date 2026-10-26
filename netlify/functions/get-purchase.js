const { json, fail, AppError } = require("./_lib/http");
const { purchaseFromToken, ensureCertificate, maskEmail } = require("./_lib/purchase");
const { COURSE_TITLE, LESSON_COUNT } = require("./_lib/course");

// Who am I / what did I buy? Needs the secret access token (Authorization: Bearer ...). Never returns the token or the full e-mail.
exports.handler = async (event) => {
  try {
    const p = await purchaseFromToken(event);
    if (!p) throw new AppError("access_denied", 401, "This access link is invalid or no longer active.");
    const cert = await ensureCertificate(p);
    return json(200, {
      name: p.customer_name, emailHint: maskEmail(p.customer_email), course: COURSE_TITLE, lessonCount: LESSON_COUNT,
      paidAt: p.paid_at, certificateId: cert.cert_id, testMode: p.rzp_mode === "test",
    });
  } catch (e) { return fail("get-purchase", e); }
};
