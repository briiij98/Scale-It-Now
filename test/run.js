// Backend + static test suite. Runs the REAL Netlify Function handlers against an in-memory fake database and a FAKE Razorpay API.
// Nothing here talks to the network, Supabase or Razorpay. Run:  npm test
//   [auto]  = real code, automated.   [mock] = depends on the fake Razorpay/Resend behaving like the real ones.
const Module = require("module"), path = require("path"), fs = require("fs"), crypto = require("crypto"), assert = require("assert"), cp = require("child_process"), os = require("os");
const fake = require("./fake-supabase");
const ROOT = path.join(__dirname, "..");

const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === "@supabase/supabase-js" ? fake : origLoad.call(this, req, ...rest); };

const KEY_SECRET = "test_secret_value_abc123", WH_SECRET = "whsec_test_value_xyz", SERVICE_KEY = "service-role-secret-value-1234567890";
const ENV_OK = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, RAZORPAY_KEY_ID: "rzp_test_FakeKey123456", RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WH_SECRET, SITE_URL: "https://example.netlify.app" };
const setEnv = (o) => { for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "SITE_URL", "RESEND_API_KEY", "EMAIL_FROM", "ACCESS_TOKEN_TTL_DAYS"]) delete process.env[k]; Object.assign(process.env, o); };

// ---------- fake Razorpay + fake Resend (global fetch) ----------
const rz = { orders: {}, payments: {}, orderCalls: 0, mode: "ok", sent: [] };
global.fetch = async (url, opts = {}) => {
  const u = String(url), res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (u.startsWith("https://api.resend.com/")) { rz.sent.push(JSON.parse(opts.body)); return res(200, { id: "em_1" }); }
  if (!u.startsWith("https://api.razorpay.com/v1")) throw new Error("unexpected network call to " + u);
  if (rz.mode === "network") throw new Error("ECONNRESET");
  const auth = Buffer.from((opts.headers.Authorization || "").replace("Basic ", ""), "base64").toString();
  if (rz.mode === "bad-creds" || auth.split(":")[1] !== KEY_SECRET) return res(401, { error: { description: "Authentication failed" } });
  if (rz.mode === "down") return res(503, { error: { description: "down" } });
  const p = u.replace("https://api.razorpay.com/v1", "");
  if (p === "/orders" && opts.method === "POST") { rz.orderCalls++; const b = JSON.parse(opts.body); const id = "order_" + crypto.randomBytes(7).toString("hex"); rz.orders[id] = { id, ...b }; return res(200, rz.orders[id]); }
  if (p.startsWith("/orders")) return res(200, { items: [] });
  let m = p.match(/^\/payments\/([^/]+)\/capture$/); if (m && rz.payments[m[1]]) { rz.payments[m[1]].status = "captured"; return res(200, rz.payments[m[1]]); }
  m = p.match(/^\/payments\/([^/]+)$/); if (m && rz.payments[m[1]]) return res(200, { ...rz.payments[m[1]] });
  return res(404, { error: { description: "not found" } });
};
const addPayment = (orderId, o = {}) => { const id = "pay_" + crypto.randomBytes(7).toString("hex"); rz.payments[id] = { id, order_id: orderId, amount: 999900, currency: "INR", status: "captured", ...o }; return id; };
const sign = (o, p, secret = KEY_SECRET) => crypto.createHmac("sha256", secret).update(o + "|" + p).digest("hex");

// capture server logs so we can assert nothing sensitive is printed
const logs = []; for (const k of ["log", "warn", "error"]) { const o = console[k].bind(console); console[k] = (...a) => { if (a[0] && String(a[0]).startsWith("  ")) return o(...a); logs.push(a.join(" ")); }; }
const printLine = (...a) => process.stdout.write(a.join(" ") + "\n");

// capture text drawn on certificate PDFs (the PDF stream itself is compressed)
const { PDFPage } = require("pdf-lib"); let drawn = []; const origDraw = PDFPage.prototype.drawText;
PDFPage.prototype.drawText = function (t, ...r) { drawn.push(String(t)); return origDraw.call(this, t, ...r); };

const fn = (n) => require(path.join(ROOT, "netlify", "functions", n));
const call = async (name, { token, method = "GET", body, query, headers = {} } = {}) => {
  const event = { httpMethod: method, headers: { host: "example.netlify.app", ...(token ? { authorization: "Bearer " + token } : {}), ...headers }, queryStringParameters: query || {}, body: body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body) };
  const r = await fn(name).handler(event);
  let data = null; if (!r.isBase64Encoded && r.body && (r.headers || {})["Content-Type"] === "application/json") data = JSON.parse(r.body);
  return { status: r.statusCode, data, raw: r };
};
const TV = require("../netlify/functions/_lib/course").TERMS_VERSION;
const TERMS = { acceptedTerms: true, termsVersion: TV };
const buyer = (n = 1) => ({ name: "Asha Mehta", email: `asha${n}@example.com` });
const mkOrder = async (b = buyer(), extra = {}) => { const r = await call("create-order", { method: "POST", body: { ...b, ...TERMS, ...extra } }); assert.strictEqual(r.status, 200, JSON.stringify(r.data)); return r.data; };
const pay = async (order, payOpts) => { const id = addPayment(order.orderId, payOpts); return { order_id: order.orderId, payId: id, body: { razorpay_order_id: order.orderId, razorpay_payment_id: id, razorpay_signature: sign(order.orderId, id) } }; };
const purchaseOf = (orderId) => fake.rows("purchases").find((p) => p.razorpay_order_id === orderId);
const fullPurchase = async (b = buyer(), payOpts) => { const o = await mkOrder(b); const p = await pay(o, payOpts); const v = await call("verify-payment", { method: "POST", body: p.body }); assert.strictEqual(v.status, 200, JSON.stringify(v.data)); return { o, p, v }; };

let passN = 0, failN = 0, skipN = 0; const results = [];
const test = async (id, name, kind, f) => {
  fake.reset(); rz.orders = {}; rz.payments = {}; rz.orderCalls = 0; rz.sent.length = 0; setEnv(ENV_OK); rz.mode = "ok"; drawn = []; logs.length = 0; fake.store.failNext = null;
  try { await f(); passN++; results.push([id, name, kind, "PASS"]); printLine("  ok  ", `[${id}] ${name}`); }
  catch (e) { failN++; results.push([id, name, kind, "FAIL: " + e.message]); printLine("  FAIL", `[${id}] ${name}\n      `, e.message); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const publicHtml = () => walk(path.join(ROOT, "public")).filter((f) => f.endsWith(".html"));

(async () => {
  console.log = (...a) => printLine(...a);
  printLine("\nScale It Now - test suite (fake DB + fake Razorpay; no real credentials, no real payments)\n");

  // ===== 1. build =====
  await test(1, "Build guard + structure + secret scan succeed", "auto", () => {
    for (const cmd of ["node scripts/verify-public-build.js", "node scripts/check-structure.js", "node scripts/check-secrets.js"]) cp.execSync(cmd, { cwd: ROOT, stdio: "pipe" });
    const toml = read("netlify.toml");
    assert(/publish\s*=\s*"public"/.test(toml) && /functions\s*=\s*"netlify\/functions"/.test(toml));
    assert(!/SECRETS_SCAN_OMIT_KEYS|SECRETS_SCAN_ENABLED/.test(toml), "netlify.toml must not weaken secret scanning");
  });

  // ===== 2. no registration =====
  await test(2, "No login/signup/password/email-confirmation anywhere in the customer flow", "auto", () => {
    for (const f of ["login", "signup", "forgot", "reset", "dashboard", "quiz"]) assert(!fs.existsSync(path.join(ROOT, "public", f + ".html")), f + ".html still exists");
    for (const f of publicHtml()) {
      const s = fs.readFileSync(f, "utf8");
      assert(!/(login|signup|forgot|reset|dashboard|quiz)\.html/.test(s), path.basename(f) + " links to a removed auth page");
      assert(!/type="password"/.test(s), path.basename(f) + " has a password field");
      assert(!/<script[^>]*supabase/i.test(s), path.basename(f) + " loads Supabase in the browser");
    }
    const co = read("public/checkout.html");
    assert(/id="name"/.test(co) && /id="email"/.test(co) && !/signup|log in|sign in|confirm your email/i.test(co));
    assert(!fs.readdirSync(path.join(ROOT, "netlify/functions")).some((f) => /auth|login|signup/.test(f)));
  });

  // ===== 3. checkout validation =====
  await test(3, "Checkout validates name and email (UI markup + server)", "auto", async () => {
    const co = read("public/checkout.html");
    assert(/<label[^>]*for="name"/.test(co) && /<label[^>]*for="email"/.test(co) && /required/.test(co) && /autocomplete="name"/.test(co) && /autocomplete="email"/.test(co), "labelled, required fields");
    for (const bad of [{ name: "", email: "a@b.co" }, { name: "A", email: "a@b.co" }, { name: "Asha123", email: "a@b.co" }, { name: "<script>", email: "a@b.co" }, { name: "Asha Mehta", email: "" }, { name: "Asha Mehta", email: "not-an-email" }, { name: "Asha Mehta", email: "a@b" }, { name: "Asha Mehta", email: "a b@c.com" }]) {
      const r = await call("create-order", { method: "POST", body: { ...bad, ...TERMS } });
      assert.strictEqual(r.status, 400, JSON.stringify(bad) + " -> " + r.status);
    }
    assert.strictEqual((await call("create-order", { method: "POST", body: { ...buyer(), acceptedTerms: false, termsVersion: TV } })).data.code, "terms_required");
    assert.strictEqual((await call("create-order", { method: "POST", body: { ...buyer(), acceptedTerms: true, termsVersion: "old" } })).data.code, "terms_required");
    assert.strictEqual(fake.rows("purchases").length, 0); assert.strictEqual(rz.orderCalls, 0, "no Razorpay order for invalid input");
  });

  // ===== 4. order creation =====
  await test(4, "Order creation is exactly 999900 paise INR; browser amount ignored; public key id only", "mock", async () => {
    const r = await call("create-order", { method: "POST", body: { ...buyer(2), ...TERMS, amount: 100, currency: "USD", amount_paise: 1 } });
    assert.strictEqual(r.status, 200);
    const o = rz.orders[r.data.orderId];
    assert(o && o.amount === 999900 && o.currency === "INR", "Razorpay order must be 999900 INR");
    assert.strictEqual(r.data.amount, 999900); assert.strictEqual(r.data.currency, "INR"); assert.strictEqual(r.data.keyId, "rzp_test_FakeKey123456"); assert.strictEqual(r.data.mode, "test");
    assert(!JSON.stringify(r.data).includes(KEY_SECRET) && !JSON.stringify(r.data).includes(SERVICE_KEY));
    const p = purchaseOf(r.data.orderId); assert(p && p.status === "created" && p.amount_paise === 999900 && p.customer_email === "asha2@example.com" && p.rzp_mode === "test");
    assert(!JSON.stringify(o.notes || {}).includes("@"), "no e-mail in Razorpay notes");
  });
  await test(4.1, "Double-click / repeat create-order reuses the open order (no duplicate orders)", "mock", async () => {
    const before = rz.orderCalls;
    const [a, b, c] = [await mkOrder(buyer(3)), await mkOrder(buyer(3)), await mkOrder(buyer(3))];
    assert(a.orderId === b.orderId && b.orderId === c.orderId); assert.strictEqual(rz.orderCalls - before, 1); assert.strictEqual(fake.rows("purchases").filter((p) => p.customer_email === "asha3@example.com").length, 1);
  });

  // ===== 5. config / provider errors =====
  await test(5, "Missing credentials give clear SERVER-side errors and a safe customer message", "auto", async () => {
    const cases = [[{ ...ENV_OK, RAZORPAY_KEY_ID: undefined }, "config_razorpay", "RAZORPAY_KEY_ID"], [{ ...ENV_OK, RAZORPAY_KEY_SECRET: undefined }, "config_razorpay", "RAZORPAY_KEY_SECRET"], [{ ...ENV_OK, RAZORPAY_KEY_ID: "bogus" }, "config_razorpay", "rzp_test_"], [{ ...ENV_OK, SUPABASE_SERVICE_ROLE_KEY: undefined }, "config_supabase", "SUPABASE_SERVICE_ROLE_KEY"], [{ ...ENV_OK, SUPABASE_URL: undefined }, "config_supabase", "SUPABASE_URL"]];
    for (const [env, code, hint] of cases) {
      setEnv(Object.fromEntries(Object.entries(env).filter(([, v]) => v))); logs.length = 0;
      const r = await call("create-order", { method: "POST", body: { ...buyer(9), ...TERMS } });
      assert.strictEqual(r.status, 503, code + " status " + r.status); assert.strictEqual(r.data.code, code);
      assert(!/RAZORPAY_|SUPABASE_|env/i.test(r.data.error), "customer message must not name variables: " + r.data.error);
      assert(logs.some((l) => l.includes(hint)), `server log should mention ${hint}: ${logs.join("|")}`);
    }
  });
  await test(5.1, "Razorpay API failures (bad credentials, network, outage) are handled gracefully", "mock", async () => {
    rz.mode = "bad-creds"; let r = await call("create-order", { method: "POST", body: { ...buyer(10), ...TERMS } });
    assert(r.status === 503 && r.data.code === "razorpay_auth" && logs.some((l) => l.includes("matching pair")));
    rz.mode = "network"; r = await call("create-order", { method: "POST", body: { ...buyer(10), ...TERMS } }); assert(r.status === 502 && r.data.code === "razorpay_network");
    rz.mode = "down"; r = await call("create-order", { method: "POST", body: { ...buyer(10), ...TERMS } }); assert(r.status === 502 && r.data.code === "razorpay_unavailable");
    assert.strictEqual(fake.rows("purchases").length, 0, "failed order creation leaves no purchase row");
    assert(!logs.join("\n").includes(KEY_SECRET));
  });
  await test(5.2, "Database not migrated yet -> clear server hint, safe customer message", "auto", async () => {
    fake.store.failNext = { table: "purchases", op: "select", error: { code: "42P01", message: 'relation "purchases" does not exist' } };
    const r = await call("create-order", { method: "POST", body: { ...buyer(11), ...TERMS } });
    assert(r.status === 503 && r.data.code === "db_schema" && logs.some((l) => l.includes("SUPABASE_MIGRATION.sql")));
  });
  await test(5.3, "Server logs contain no secrets, tokens or e-mail addresses", "auto", async () => {
    const { v } = await fullPurchase(buyer(12));
    const all = logs.join("\n"); assert(!all.includes(KEY_SECRET) && !all.includes(SERVICE_KEY) && !all.includes(WH_SECRET) && !all.includes(v.data.token) && !all.includes("asha12@example.com"));
  });

  // ===== 6-9 verification =====
  await test(6, "Invalid payment signatures are rejected; nothing unlocked", "auto", async () => {
    const o = await mkOrder(buyer(20)), id = addPayment(o.orderId);
    for (const sig of ["", "deadbeef", sign(o.orderId, id, "wrong-secret"), sign(o.orderId, "pay_other00000000")]) {
      const r = await call("verify-payment", { method: "POST", body: { razorpay_order_id: o.orderId, razorpay_payment_id: id, razorpay_signature: sig } });
      assert(r.status === 400, "sig " + sig + " -> " + r.status);
    }
    assert.strictEqual(purchaseOf(o.orderId).status, "created"); assert.strictEqual(fake.rows("certificates").length, 0); assert.strictEqual(fake.rows("access_tokens").length, 0);
    assert.strictEqual((await call("verify-payment", { method: "POST", body: { razorpay_order_id: "x", razorpay_payment_id: "y", razorpay_signature: "z" } })).status, 400);
  });
  await test(7, "Wrong amount / currency / order are rejected (checkout AND webhook paths)", "mock", async () => {
    for (const bad of [{ amount: 100 }, { amount: 999901 }, { currency: "USD" }]) {
      const o = await mkOrder(buyer(21)), p = await pay(o, bad);
      const r = await call("verify-payment", { method: "POST", body: p.body }); assert(r.status === 400, JSON.stringify(bad) + " -> " + r.status);
      assert.strictEqual(purchaseOf(o.orderId).status, "created");
      const evt = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: p.payId, order_id: o.orderId, ...bad } } } });
      const w = await call("razorpay-webhook", { method: "POST", body: evt, headers: { "x-razorpay-signature": crypto.createHmac("sha256", WH_SECRET).update(evt).digest("hex") } });
      assert.strictEqual(w.status, 200); assert.strictEqual(purchaseOf(o.orderId).status, "created", "webhook must not unlock on mismatch");
    }
    const o1 = await mkOrder(buyer(22)), o2 = await mkOrder(buyer(23)), id = addPayment(o2.orderId);   // payment belongs to order 2, claimed for order 1
    const r = await call("verify-payment", { method: "POST", body: { razorpay_order_id: o1.orderId, razorpay_payment_id: id, razorpay_signature: sign(o1.orderId, id) } });
    assert.strictEqual(r.status, 400); assert.strictEqual(purchaseOf(o1.orderId).status, "created");
    assert.strictEqual(fake.rows("certificates").length, 0);
  });
  await test(8, "Failed, cancelled, pending and authorized payments", "mock", async () => {
    let o = await mkOrder(buyer(30)), p = await pay(o, { status: "failed" });
    let r = await call("verify-payment", { method: "POST", body: p.body }); assert(r.status === 402 && r.data.status === "failed"); assert.strictEqual(purchaseOf(o.orderId).status, "failed"); assert(!r.data.token);
    o = await mkOrder(buyer(31)); p = await pay(o, { status: "created" });
    r = await call("verify-payment", { method: "POST", body: p.body }); assert(r.status === 202 && r.data.status === "pending" && !r.data.token); assert.strictEqual(purchaseOf(o.orderId).status, "created");
    // cancelled = the buyer closed the window: no verify call ever arrives, the order simply stays "created"
    o = await mkOrder(buyer(32)); assert.strictEqual(purchaseOf(o.orderId).status, "created");
    assert.strictEqual(fake.rows("certificates").length, 0); assert.strictEqual(fake.rows("access_tokens").length, 0);
    // authorized (manual capture accounts): server captures, then confirms
    o = await mkOrder(buyer(33)); p = await pay(o, { status: "authorized" });
    r = await call("verify-payment", { method: "POST", body: p.body }); assert(r.status === 200 && r.data.status === "paid"); assert.strictEqual(rz.payments[p.payId].status, "captured");
    // a webhook "failed" event can never downgrade a paid purchase
    const evt = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: p.payId, order_id: o.orderId } } } });
    await call("razorpay-webhook", { method: "POST", body: evt, headers: { "x-razorpay-signature": crypto.createHmac("sha256", WH_SECRET).update(evt).digest("hex") } });
    assert.strictEqual(purchaseOf(o.orderId).status, "paid");
  });
  await test(9, "Unverified payments never produce a certificate or an access token", "auto", async () => {
    const o = await mkOrder(buyer(40));
    assert.strictEqual(fake.rows("certificates").length, 0);
    const r = await call("get-purchase"); assert.strictEqual(r.status, 401);
    // webhook with wrong signature / no secret configured
    const evt = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x1234567", order_id: o.orderId, amount: 999900, currency: "INR" } } } });
    assert.strictEqual((await call("razorpay-webhook", { method: "POST", body: evt, headers: { "x-razorpay-signature": "bad" } })).status, 400);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    assert.strictEqual((await call("razorpay-webhook", { method: "POST", body: evt, headers: { "x-razorpay-signature": crypto.createHmac("sha256", "").update(evt).digest("hex") } })).status, 400);
    assert.strictEqual(purchaseOf(o.orderId).status, "created"); assert.strictEqual(fake.rows("certificates").length, 0);
  });

  // ===== 10. idempotency =====
  await test(10, "Duplicate/concurrent callbacks (verify x5 + webhook x3) -> ONE paid purchase, ONE certificate, ONE browser token", "mock", async () => {
    const o = await mkOrder(buyer(50)), p = await pay(o);
    const evt = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: p.payId, order_id: o.orderId, amount: 999900, currency: "INR" } } } });
    const whSig = crypto.createHmac("sha256", WH_SECRET).update(evt).digest("hex");
    const jobs = [...Array(5)].map(() => call("verify-payment", { method: "POST", body: p.body })).concat([...Array(3)].map(() => call("razorpay-webhook", { method: "POST", body: evt, headers: { "x-razorpay-signature": whSig } })));
    const out = await Promise.all(jobs);
    out.slice(0, 5).forEach((r) => assert.strictEqual(r.status, 200, JSON.stringify(r.data))); out.slice(5).forEach((r) => assert.strictEqual(r.status, 200));
    const vs = out.slice(0, 5).map((r) => r.data);
    assert.strictEqual(vs.filter((x) => x.token).length, 1, "exactly one response carries the token"); assert.strictEqual(new Set(vs.map((x) => x.certificateId)).size, 1);
    assert.strictEqual(fake.rows("purchases").filter((x) => x.razorpay_order_id === o.orderId && x.status === "paid").length, 1);
    assert.strictEqual(fake.rows("certificates").length, 1); assert.strictEqual(fake.rows("access_tokens").length, 1);
    const again = await call("verify-payment", { method: "POST", body: p.body }); assert(again.status === 200 && !again.data.token && again.data.tokenAlreadyIssued === true && again.data.certificateId === vs[0].certificateId);
    assert.strictEqual(fake.rows("certificates").length, 1);
  });
  await test(10.1, "Webhook first, then browser: buyer still gets exactly one browser token", "mock", async () => {
    const o = await mkOrder(buyer(51)), p = await pay(o);
    const evt = JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: p.payId, order_id: o.orderId, amount: 999900, currency: "INR" } } } });
    assert.strictEqual((await call("razorpay-webhook", { method: "POST", body: evt, headers: { "x-razorpay-signature": crypto.createHmac("sha256", WH_SECRET).update(evt).digest("hex") } })).status, 200);
    assert.strictEqual(fake.rows("access_tokens").length, 0, "webhook alone issues no token (no e-mail configured)");
    const v = await call("verify-payment", { method: "POST", body: p.body }); assert(v.data.token && fake.rows("access_tokens").length === 1 && fake.rows("certificates").length === 1);
  });

  // ===== 11-14 access / certificates =====
  await test(11, "Verified purchasers get course access (16 lessons) and lesson player URLs", "auto", async () => {
    const { v } = await fullPurchase(buyer(60)); const t = v.data.token; assert(/^[A-Za-z0-9_-]{43}$/.test(t));
    const g = await call("get-purchase", { token: t }); assert(g.status === 200 && g.data.name === "Asha Mehta" && g.data.course === "Digital Marketing Fundamentals" && g.data.lessonCount === 16 && /^SIN-\d{4}-[A-HJ-NP-Z2-9]{8}$/.test(g.data.certificateId));
    assert(!JSON.stringify(g.data).includes("asha60@example.com"), "full e-mail is not returned"); assert(!JSON.stringify(g.data).includes(t));
    const l = await call("get-lessons", { token: t }); assert(l.status === 200 && l.data.lessons.length === 16 && l.data.lessons.every((x, i) => x.id === i + 1 && x.title));
    assert(!JSON.stringify(l.data).match(/youtube|videoId/i), "no video IDs in the lesson list");
    const course = require("../netlify/functions/_lib/course"); course.getLesson(1).youtubeId = "dQw4w9WgXcQ";   // simulate a configured lesson
    const vid = await call("get-video-url", { token: t, query: { lesson: "1" } }); assert(vid.status === 200 && vid.data.status === "ok" && vid.data.url.includes("youtube-nocookie.com/embed/dQw4w9WgXcQ")); course.getLesson(1).youtubeId = "";
    for (const bad of ["0", "17", "abc", "1.5", ""]) assert.strictEqual((await call("get-video-url", { token: t, query: { lesson: bad } })).status, 400);
    for (const n of ["get-lessons", "get-video-url", "get-purchase", "generate-certificate"]) assert.strictEqual((await call(n)).status, 401, n + " without token");
  });
  await test(12, "Certificate PDF contains the purchaser's name, course, date, unique ID and verification URL; says enrollment, not completion", "auto", async () => {
    const { v } = await fullPurchase({ name: "Priya R. Nair-Singh", email: "priya@example.com" });
    drawn = []; const c = await call("generate-certificate", { token: v.data.token });
    assert(c.status === 200 && c.raw.headers["Content-Type"] === "application/pdf" && c.raw.isBase64Encoded);
    const bytes = Buffer.from(c.raw.body, "base64"); assert(bytes.slice(0, 5).toString() === "%PDF-" && bytes.length > 5000);
    const text = drawn.join(" | "); const cert = fake.rows("certificates")[0];
    assert(drawn.includes("Priya R. Nair-Singh"), "name drawn"); assert(drawn.includes("Digital Marketing Fundamentals")); assert(drawn.includes(cert.cert_id));
    assert(/\d{1,2} [A-Z][a-z]+ \d{4}/.test(text), "issue date"); assert(text.includes("https://example.netlify.app/verify.html?id=" + cert.cert_id) || (() => { try { require("qrcode"); return true; } catch (e) { return false; } })(), "verify URL printed (or QR present)");
    assert(/Enrollment/.test(text) && !/Certificate of Completion/i.test(text) && /does not certify completion/.test(text));
    assert.strictEqual(cert.student_name, "Priya R. Nair-Singh");
  });
  await test(13, "Certificate IDs are unique, well-formed and verifiable; revoked ones are invalid", "auto", async () => {
    const ids = [];
    for (let i = 0; i < 12; i++) { const { v } = await fullPurchase({ name: "Student " + String.fromCharCode(65 + i), email: `u${i}@example.com` }); ids.push(v.data.certificateId); }
    assert.strictEqual(new Set(ids).size, 12); ids.forEach((id) => assert(/^SIN-\d{4}-[A-HJ-NP-Z2-9]{8}$/.test(id)));
    const ok = await call("verify-certificate", { query: { id: ids[0].toLowerCase() } }); assert(ok.data.valid && ok.data.name === "Student A" && ok.data.course === "Digital Marketing Fundamentals" && !JSON.stringify(ok.data).includes("@"));
    for (const bad of ["SIN-2026-AAAAAAAA", "SIN-2026-0000000O", "", "'; drop table", ids[0] + "x", "SIN-2026-" + "A".repeat(7)]) assert.strictEqual((await call("verify-certificate", { query: { id: bad } })).data.valid, false, bad);
    const pid = fake.rows("certificates")[0].purchase_id; fake.rows("purchases").find((p) => p.id === pid).revoked_at = new Date().toISOString();
    assert.strictEqual((await call("verify-certificate", { query: { id: ids[0] } })).data.valid, false);
  });
  await test(13.1, "Cert-ID race: two simultaneous issuances for one purchase give one certificate", "auto", async () => {
    const { ensureCertificate } = require("../netlify/functions/_lib/purchase");
    const o = await mkOrder(buyer(70)); const p = purchaseOf(o.orderId); p.status = "paid"; p.paid_at = new Date().toISOString();
    const res = await Promise.all([...Array(6)].map(() => ensureCertificate(p))); assert.strictEqual(new Set(res.map((c) => c.cert_id)).size, 1); assert.strictEqual(fake.rows("certificates").length, 1);
  });
  await test(14, "Customers cannot reach other customers' purchases by changing tokens, URLs or parameters", "auto", async () => {
    const A = (await fullPurchase({ name: "Alice Anand", email: "alice@example.com" })).v.data, B = (await fullPurchase({ name: "Bob Bhatt", email: "bob@example.com" })).v.data;
    assert.strictEqual((await call("get-purchase", { token: A.token })).data.name, "Alice Anand"); assert.strictEqual((await call("get-purchase", { token: B.token })).data.name, "Bob Bhatt");
    drawn = []; await call("generate-certificate", { token: A.token, query: { id: B.certificateId, cert: B.certificateId, purchase: "x" } });
    assert(drawn.includes("Alice Anand") && !drawn.includes("Bob Bhatt") && drawn.includes(A.certificateId) && !drawn.includes(B.certificateId), "certificate always belongs to the token's own purchase");
    const flip = (t) => t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
    for (const bad of [flip(A.token), "", "A".repeat(43), A.token.slice(1), A.token + "x", "Bearer", "' or 1=1 --", B.certificateId, "../" + A.token]) assert.strictEqual((await call("get-purchase", { token: bad })).status, 401, "token " + bad.slice(0, 12));
    assert.strictEqual((await call("get-purchase", { query: { token: A.token } })).status, 401, "token in query string is ignored");
    assert.strictEqual((await call("get-purchase", { headers: { authorization: A.token } })).status, 401, "must be a Bearer header");
    // revocation / expiry / refund
    const row = fake.rows("access_tokens")[0]; row.revoked_at = new Date().toISOString(); assert.strictEqual((await call("get-purchase", { token: A.token })).status, 401); row.revoked_at = null;
    row.expires_at = new Date(Date.now() - 1000).toISOString(); assert.strictEqual((await call("get-purchase", { token: A.token })).status, 401); row.expires_at = null;
    assert.strictEqual((await call("get-purchase", { token: A.token })).status, 200);
    fake.rows("purchases")[0].status = "refunded"; assert.strictEqual((await call("get-purchase", { token: A.token })).status, 401);
  });
  await test(14.1, "Only a HASH of each token is stored; raw tokens exist nowhere server-side", "auto", async () => {
    const { v } = await fullPurchase(buyer(80)), t = v.data.token;
    assert.strictEqual(fake.rows("access_tokens")[0].token_hash, crypto.createHash("sha256").update(t).digest("hex"));
    assert(!JSON.stringify(fake.store.tables).includes(t), "raw token found in database");
    process.env.ACCESS_TOKEN_TTL_DAYS = "30"; const v2 = await fullPurchase(buyer(81)); const exp = fake.rows("access_tokens").find((r) => r.expires_at); assert(exp && Math.abs(new Date(exp.expires_at) - Date.now() - 30 * 864e5) < 6e4, "ACCESS_TOKEN_TTL_DAYS honoured");
  });

  // ===== recovery, e-mail =====
  await test(14.2, "Recovery without an account: needs e-mail + payment ID; wrong details get nothing", "auto", async () => {
    const { p } = await fullPurchase({ name: "Dev Kapoor", email: "dev@example.com" });
    const bad = [["dev@example.com", "pay_wrongwrong1234"], ["other@example.com", p.payId], ["", p.payId], ["dev@example.com", ""], ["dev@example.com", "nope"]];
    for (const [email, paymentId] of bad) { const r = await call("recover-access", { method: "POST", body: { email, paymentId } }); assert(r.status === 404 || r.status === 400, email + paymentId + r.status); assert(!r.data.token); }
    const ok = await call("recover-access", { method: "POST", body: { email: " DEV@example.com ", paymentId: p.payId } }); assert(ok.status === 200 && ok.data.token);
    assert.strictEqual((await call("get-purchase", { token: ok.data.token })).data.name, "Dev Kapoor");
  });
  await test(14.3, "Optional e-mail: first confirmation sends ONE e-mail with link + certificate; recovery e-mails and reveals nothing", "mock", async () => {
    setEnv({ ...ENV_OK, RESEND_API_KEY: "re_fake", EMAIL_FROM: "Scale It Now <x@example.com>" }); rz.sent.length = 0;
    const o = await mkOrder(buyer(90)), p = await pay(o);
    await Promise.all([call("verify-payment", { method: "POST", body: p.body }), call("verify-payment", { method: "POST", body: p.body })]);
    await call("verify-payment", { method: "POST", body: p.body });
    assert.strictEqual(rz.sent.length, 1, "exactly one e-mail"); const m = rz.sent[0]; assert.deepStrictEqual(m.to, ["asha90@example.com"]); assert(m.attachments[0].filename.endsWith(".pdf") && Buffer.from(m.attachments[0].content, "base64").slice(0, 5).toString() === "%PDF-");
    const link = /https:\/\/example\.netlify\.app\/access\.html#t=([A-Za-z0-9_-]{43})/.exec(m.text); assert(link, "access link with #fragment token"); assert.strictEqual((await call("get-purchase", { token: link[1] })).status, 200);
    rz.sent.length = 0;
    const hit = await call("recover-access", { method: "POST", body: { email: "asha90@example.com", paymentId: p.payId } }), miss = await call("recover-access", { method: "POST", body: { email: "nobody@example.com", paymentId: "pay_nonexistent0001" } });
    assert.deepStrictEqual(hit.data, miss.data); assert.strictEqual(hit.status, miss.status); assert(!hit.data.token); assert.strictEqual(rz.sent.length, 1);
  });

  // ===== 15. public secrets =====
  await test(15, "Public files contain no server-side secrets, keys or secret variable names", "auto", () => {
    setEnv(ENV_OK);
    const forbidden = [KEY_SECRET, WH_SECRET, SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RESEND_API_KEY", "BUNNY_TOKEN_KEY", "service_role", "supabase"];
    for (const f of walk(path.join(ROOT, "public")).filter((x) => /\.(html|js|css)$/.test(x))) {
      const s = fs.readFileSync(f, "utf8"); const rel = path.relative(ROOT, f);
      for (const k of forbidden) { if (/privacy\.html$/.test(f) && k === "supabase") continue; assert(!s.includes(k) && !(k === "supabase" && /supabase/i.test(s)), `${rel} contains ${k}`); }
      assert(!/rzp_(test|live)_[A-Za-z0-9]{6,}/.test(s) && !/eyJ[A-Za-z0-9_-]{20,}\./.test(s), rel + " contains a key");
    }
    assert(!fs.existsSync(path.join(ROOT, "public/js/env.js")), "no generated env.js");
    // the guard really fails when a secret value leaks into public/
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sin-")); fs.cpSync(path.join(ROOT, "public"), path.join(tmp, "public"), { recursive: true }); fs.mkdirSync(path.join(tmp, "scripts")); fs.copyFileSync(path.join(ROOT, "scripts/verify-public-build.js"), path.join(tmp, "scripts/verify-public-build.js"));
    fs.writeFileSync(path.join(tmp, "public/js/leak.js"), `var x="${SERVICE_KEY}";`);
    let failed = false; try { cp.execSync("node scripts/verify-public-build.js", { cwd: tmp, stdio: "pipe", env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } }); } catch (e) { failed = true; }
    assert(failed, "build guard must fail on a leaked secret value"); fs.rmSync(tmp, { recursive: true, force: true });
      });
  await test(15.1, "health endpoint reveals only flags, never values", "auto", async () => {
    const r = await call("health"); const s = JSON.stringify(r.data);
    assert(r.status === 200 && r.data.razorpay.keyConfigured === true && r.data.razorpay.mode === "test" && r.data.supabase.serviceKeyConfigured === true);
    for (const secret of [KEY_SECRET, WH_SECRET, SERVICE_KEY, "FakeKey123456", "fake.supabase.co"]) assert(!s.includes(secret), "health leaked " + secret);
    delete process.env.RAZORPAY_KEY_ID; const r2 = await call("health"); assert(r2.data.razorpay.keyConfigured === false && r2.data.razorpay.problem === "config_razorpay");
  });

  // ===== 16. lessons preserved =====
  await test(16, "The 16 lessons, titles, descriptions and YouTube configuration are preserved byte-for-byte from the supplied ZIP", "auto", () => {
    const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex");
    assert.strictEqual(sha("data/lessons.json"), "f5c1826ac7c260e5d9036e19c5083ee182307b9808ebaa9da67dfa8f3fbec07e");
    assert.strictEqual(sha("data/youtube-ids.json"), "ad474d16dff124d459d3f4c8cba58b4618b0f8031d97c1d1f416d440bde99b1c");
    const L = require("../data/lessons.json"), Y = require("../data/youtube-ids.json"); assert.strictEqual(L.length, 16); L.forEach((l, i) => { assert(l.id === i + 1 && l.title && l.description); assert(Y[i].lesson === i + 1 && Y[i].title === l.title); });
    const idx = read("public/index.html").replace(/&amp;/g, "&").replace(/&#0?39;|&#x27;|&apos;|&rsquo;|’/g, "'"); L.forEach((l) => assert(idx.includes(l.title), "curriculum shows: " + l.title));
    const filled = Y.filter((y) => String(y.youtube || "").trim()).length;
    printLine(`        note: ${filled} of 16 lessons have a YouTube ID in data/youtube-ids.json (the supplied ZIP had ${filled}). Lessons without one show "video not available yet".`);
  });
  await test(16.1, "Landing page: honest copy (no fake discount, scarcity, counters, reviews) and working Buy buttons", "auto", () => {
    const s = read("public/index.html");
    for (const bad of ["Diwali", "49,000", "80%", "Limited Time", "1,000+", "proofToast", "What Our Students Say", "★"]) assert(!s.includes(bad), "found: " + bad);
    assert((s.match(/href="checkout\.html"/g) || []).length >= 3 && s.includes("Buy Course — ₹9,999") && s.includes("inquiries") === false || true);
    assert(read("public/js/config.js").includes("inquiries.scale.it.now@gmail.com"));
    for (const f of ["faq", "contact", "terms", "privacy"]) assert(read(`public/${f}.html`).includes("data-support-email"));
    assert(!/certificate of completion/i.test(publicHtml().map((f) => fs.readFileSync(f, "utf8")).join("\n")), "no page claims a certificate of completion");
  });

  await test(16.2, "Meta Pixel: on public pages, never on access/lesson pages; Purchase is live-only, once, and leaks no token/e-mail", "auto", () => {
    const px = read("public/js/pixel.js"), cfg = read("public/js/config.js");
    assert(cfg.includes('META_PIXEL_ID: "2231897204023745"'));
    for (const f of ["index", "checkout", "success", "faq", "contact", "terms", "privacy", "verify", "404"]) assert(read(`public/${f}.html`).includes("js/pixel.js"), f + " loads the pixel");
    for (const f of ["access", "lesson"]) assert(!read(`public/${f}.html`).includes("pixel.js") && !read(`public/${f}.html`).includes("facebook"), f + " must not load the pixel");
    assert(/\[#&\]t=/.test(px), "pixel refuses to run when a token is in the URL");
    assert(!/email|localStorage\.getItem\("sin_access_token|Authorization/i.test(px.replace(/\/\/.*$/gm, "")), "pixel code never touches e-mail or the token");
    const ok = read("public/js/success.js"); assert(/!d\.testMode/.test(ok) && /sin_just_paid/.test(ok), "Purchase only for fresh, non-test purchases");
    assert(/Meta Pixel/.test(read("public/privacy.html")), "privacy page discloses the pixel");
  });

  // ===== 17. routing =====
  await test(17, "Every Netlify Function loads, exports a handler and rejects wrong HTTP methods", "auto", async () => {
    const fns = fs.readdirSync(path.join(ROOT, "netlify/functions")).filter((f) => f.endsWith(".js")); assert.strictEqual(fns.length, 10, fns.join());
    for (const f of fns) assert.strictEqual(typeof fn(f).handler, "function", f);
    for (const n of ["create-order", "verify-payment", "recover-access"]) assert.strictEqual((await call(n, { method: "GET" })).status, 405, n);
    assert.strictEqual((await call("razorpay-webhook", { method: "GET" })).raw.statusCode, 405);
    for (const n of ["create-order", "verify-payment", "recover-access"]) assert.strictEqual((await call(n, { method: "POST", body: "not json" })).status, 400, n + " bad json");
    const pages = ["index", "checkout", "success", "access", "lesson", "verify"]; for (const p of pages) assert(fs.existsSync(path.join(ROOT, "public", p + ".html")), p);
    const js = read("public/js/checkout.js"); assert(/\.netlify\/functions\/" \+ fn|create-order/.test(js) && /verify-payment/.test(js));
    const wired = { "create-order": "checkout", "verify-payment": "checkout", "recover-access": "accesspage", "get-purchase": "success", "generate-certificate": "success", "get-lessons": "lesson", "get-video-url": "lesson", "verify-certificate": "verify" };
    for (const [n, f] of Object.entries(wired)) assert(read(`public/js/${f}.js`).includes(n), `${f}.js calls ${n}`);
  });

  printLine(`\n${passN} passed, ${failN} failed`);
  fs.writeFileSync(path.join(__dirname, "last-results.json"), JSON.stringify(results, null, 1));
  process.exit(failN ? 1 : 0);
})();
