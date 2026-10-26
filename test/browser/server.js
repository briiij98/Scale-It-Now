// TEST-ONLY server for the browser smoke test: serves public/ and runs the REAL Netlify Function handlers against the fake
// database and a fake Razorpay. /__test/pay simulates what Razorpay Checkout would hand back after a payment.
const Module = require("module"), http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const fake = require("../fake-supabase");
const o = Module._load; Module._load = function (r, ...a) { return r === "@supabase/supabase-js" ? fake : o.call(this, r, ...a); };
const ROOT = path.join(__dirname, "..", ".."), SECRET = "browser_test_secret";
Object.assign(process.env, { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-fake-key-123456", RAZORPAY_KEY_ID: "rzp_test_BrowserFake1", RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: "wh" });
const orders = {}, payments = {};
global.fetch = async (url, opts = {}) => {
  const u = String(url).replace("https://api.razorpay.com/v1", ""), ok = (b) => ({ ok: true, status: 200, json: async () => b });
  if (u === "/orders") { const b = JSON.parse(opts.body), id = "order_" + crypto.randomBytes(6).toString("hex"); orders[id] = { id, ...b }; return ok(orders[id]); }
  const m = u.match(/^\/payments\/([^/]+)$/); if (m && payments[m[1]]) return ok(payments[m[1]]);
  return { ok: false, status: 404, json: async () => ({}) };
};
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__test/live") { process.env.RAZORPAY_KEY_ID = url.searchParams.get("on") === "1" ? "rzp_live_BrowserFake1" : "rzp_test_BrowserFake1"; return res.end("ok"); }
  if (url.pathname === "/__test/pay") { // simulate a successful payment for ?order=
    const order = url.searchParams.get("order"), id = "pay_" + crypto.randomBytes(7).toString("hex");
    payments[id] = { id, order_id: order, amount: 999900, currency: "INR", status: url.searchParams.get("status") || "captured" };
    res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ razorpay_order_id: order, razorpay_payment_id: id, razorpay_signature: crypto.createHmac("sha256", SECRET).update(order + "|" + id).digest("hex") }));
  }
  if (url.pathname.startsWith("/.netlify/functions/")) {
    const name = url.pathname.split("/").pop(); let body = ""; for await (const c of req) body += c;
    const r = await require(path.join(ROOT, "netlify/functions", name)).handler({ httpMethod: req.method, headers: { ...req.headers, host: req.headers.host }, queryStringParameters: Object.fromEntries(url.searchParams), body: body || null });
    res.writeHead(r.statusCode, r.headers); return res.end(r.isBase64Encoded ? Buffer.from(r.body, "base64") : r.body);
  }
  let f = path.join(ROOT, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
}).listen(Number(process.env.PORT || 8799), () => console.log("ready"));
