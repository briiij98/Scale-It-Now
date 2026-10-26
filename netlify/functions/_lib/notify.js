const email = require("./email");
const { issueToken } = require("./purchase");
const { renderCertificate } = require("./certificate");
const { siteUrl } = require("./http");
const { COURSE_TITLE } = require("./course");
const SUPPORT = "inquiries.scale.it.now@gmail.com";

// Optional: e-mail the buyer a private access link plus the certificate PDF. Failures are logged and ignored.
async function notifyBuyer(event, { purchase, certificate }) {
  if (!email.isConfigured()) return { sent: false, reason: "not_configured" };
  try {
    const base = siteUrl(event), token = await issueToken(purchase.id);
    const verifyUrl = `${base}/verify.html?id=${certificate.cert_id}`;
    const pdf = await renderCertificate({ name: certificate.student_name, course: certificate.course_title, issuedOn: certificate.completed_on, certId: certificate.cert_id, verifyUrl });
    const m = email.purchaseEmail({ name: purchase.customer_name, course: COURSE_TITLE, accessUrl: `${base}/access.html#t=${token}`, certId: certificate.cert_id, verifyUrl, supportEmail: SUPPORT });
    return await email.send({ to: purchase.customer_email, ...m, attachments: [{ filename: `${certificate.cert_id}.pdf`, content: Buffer.from(pdf).toString("base64") }] });
  } catch (e) { console.error(JSON.stringify({ fn: "notify", code: e.code || "notify_failed", reason: String(e.message).slice(0, 120) })); return { sent: false, reason: "error" }; }
}
module.exports = { notifyBuyer, SUPPORT };
