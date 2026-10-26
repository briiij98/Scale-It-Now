// Shared HTTP helpers + a typed error so every function reports problems the same way.
const json = (status, body, headers = {}) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  body: JSON.stringify(body),
});

// AppError carries (a) a short machine code for logs, (b) an HTTP status and (c) a message that is SAFE to show a customer.
// Anything that is not an AppError is reported as a generic 500 and only logged on the server.
class AppError extends Error {
  constructor(code, status, publicMessage, detail) {
    super(detail || publicMessage);
    this.code = code; this.status = status; this.publicMessage = publicMessage;
  }
}

// Logs useful diagnostics WITHOUT secrets or personal data: only function name, error code and a short, scrubbed reason.
const scrub = (s) => String(s || "").replace(/(rzp_(?:test|live)_)[A-Za-z0-9]+/g, "$1***").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>").slice(0, 300);
function fail(fnName, e, extra = {}) {
  if (e instanceof AppError) {
    console.error(JSON.stringify({ fn: fnName, code: e.code, reason: scrub(e.message) }));
    return json(e.status, { error: e.publicMessage, code: e.code, ...extra });
  }
  console.error(JSON.stringify({ fn: fnName, code: "internal", reason: scrub(e && e.message) }));
  return json(500, { error: "Something went wrong on our side. Please try again in a moment.", code: "internal", ...extra });
}

function parseBody(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}";
    const b = JSON.parse(raw || "{}");
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch { return {}; }
}

// The public base URL used in certificate QR codes and e-mailed links. SITE_URL wins (custom domain), then Netlify's URL.
function siteUrl(event) {
  const h = (event && event.headers) || {};
  const host = h["x-forwarded-host"] || h.host;
  return (process.env.SITE_URL || process.env.URL || (host ? `https://${host}` : "")).replace(/\/+$/, "");
}
module.exports = { json, AppError, fail, parseBody, siteUrl, scrub };
