const { json, fail, siteUrl, AppError } = require("./_lib/http");
const { purchaseFromToken, ensureCertificate } = require("./_lib/purchase");
const { renderCertificate } = require("./_lib/certificate");

// Returns the buyer's OWN certificate PDF. The certificate is identified by the purchase behind the secret token,
// never by an ID/URL parameter, so one customer cannot fetch another customer's certificate.
exports.handler = async (event) => {
  try {
    const p = await purchaseFromToken(event);
    if (!p) throw new AppError("access_denied", 401, "This access link is invalid or no longer active.");
    const cert = await ensureCertificate(p);
    const pdf = await renderCertificate({
      name: cert.student_name, course: cert.course_title, issuedOn: cert.completed_on,
      certId: cert.cert_id, verifyUrl: `${siteUrl(event)}/verify.html?id=${cert.cert_id}`,
    });
    return {
      statusCode: 200, isBase64Encoded: true, body: Buffer.from(pdf).toString("base64"),
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${cert.cert_id}.pdf"`, "Cache-Control": "no-store" },
    };
  } catch (e) { return fail("generate-certificate", e); }
};
