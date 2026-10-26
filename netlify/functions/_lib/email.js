// OPTIONAL e-mail delivery through Resend (https://resend.com). If RESEND_API_KEY / EMAIL_FROM are not set, nothing is sent
// and the site works without it (the buyer gets the access link on the success page).
const isConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
async function send({ to, subject, text, html, attachments }) {
  if (!isConfigured()) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html, attachments }),
    });
    if (!res.ok) { console.error(JSON.stringify({ fn: "email", code: "send_failed", status: res.status })); return { sent: false, reason: "provider_error" }; }
    return { sent: true };
  } catch (e) { console.error(JSON.stringify({ fn: "email", code: "send_error", reason: String(e.message).slice(0, 120) })); return { sent: false, reason: "network" }; }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function purchaseEmail({ name, course, accessUrl, certId, verifyUrl, supportEmail }) {
  const text = `Hi ${name},\n\nThank you for enrolling in ${course}.\n\nYour private course link (keep it to yourself - anyone with it can open the course):\n${accessUrl}\n\nYour certificate of enrollment is attached (ID ${certId}). Verify it at: ${verifyUrl}\n\nQuestions? Write to ${supportEmail}.\n\nScale It Now`;
  const html = `<p>Hi ${esc(name)},</p><p>Thank you for enrolling in <b>${esc(course)}</b>.</p><p><a href="${esc(accessUrl)}">Open my course</a><br><small>This link is private: anyone who has it can open the course.</small></p><p>Your certificate of enrollment is attached (ID ${esc(certId)}). Verify it at <a href="${esc(verifyUrl)}">${esc(verifyUrl)}</a>.</p><p>Questions? Write to <a href="mailto:${esc(supportEmail)}">${esc(supportEmail)}</a>.</p><p>Scale It Now</p>`;
  return { subject: `Your ${course} course access and certificate`, text, html };
}
module.exports = { isConfigured, send, purchaseEmail };
