// Run from the project root:  node scripts/check-structure.js   (or: npm run check)
// Confirms required files exist, netlify.toml matches the folders, every require() resolves, and every
// local src/href in every HTML page points at a file that exists (and every #anchor exists on its page).
const fs = require("fs"), path = require("path");
const pages = ["index", "checkout", "success", "access", "lesson", "verify", "faq", "contact", "privacy", "terms", "404"];
const fns = ["create-order", "verify-payment", "razorpay-webhook", "get-purchase", "get-lessons", "get-video-url", "generate-certificate", "verify-certificate", "recover-access", "health"];
const required = [
  "netlify.toml", "package.json", "README.md", ".env.example", ".gitignore", "supabase/schema.sql", "data/lessons.json", "SUPABASE_MIGRATION.sql", "ENVIRONMENT_VARIABLES.md", "README_DEPLOY.md", "TEST_REPORT.md",
  "scripts/connect-bunny.js", "scripts/check-secrets.js", "scripts/verify-public-build.js", "scripts/youtube-status.js", "data/youtube-ids.json", "public/assets/hero-800.webp", "public/assets/hero-1200.webp", "public/css/styles.css", "public/assets/logo.jpg", "public/assets/logo-mark.jpg", "public/assets/hero.jpg",
  ...["config", "site", "access", "checkout", "success", "accesspage", "lesson", "landing", "verify"].map((j) => `public/js/${j}.js`),
  ...pages.map((p) => `public/${p}.html`),
  ...fns.map((f) => `netlify/functions/${f}.js`),
  ...["http", "supabase", "razorpay", "purchase", "email", "notify", "certificate", "assets", "course", "bunny", "youtube"].map((f) => `netlify/functions/_lib/${f}.js`),
];
let bad = 0; const fail = (m) => { bad++; console.log("FAIL", m); };
required.forEach((f) => { if (!fs.existsSync(f)) fail("missing " + f); });
const toml = fs.existsSync("netlify.toml") ? fs.readFileSync("netlify.toml", "utf8") : "";
if (!/publish\s*=\s*"public"/.test(toml)) fail('netlify.toml must have publish = "public"');
if (!/functions\s*=\s*"netlify\/functions"/.test(toml)) fail('netlify.toml must have functions = "netlify/functions"');
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
for (const f of walk("netlify/functions").filter((x) => x.endsWith(".js"))) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/require\("(\.[^"]+)"\)/g)) {
    const t = path.resolve(path.dirname(f), m[1]);
    if (![t, t + ".js", t + ".json"].some((p) => fs.existsSync(p))) fail(`${f} requires ${m[1]} (not found)`);
  }
}
const lessons = JSON.parse(fs.readFileSync("data/lessons.json", "utf8"));
if (lessons.length !== 16 || lessons.some((l, i) => l.id !== i + 1)) fail("data/lessons.json must contain lessons with ids 1..16");
const htmlFiles = walk("public").filter((x) => x.endsWith(".html"));
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, "utf8");
  const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(u) || u === "#") continue;
    const [p, hash] = u.split("#"); const clean = p.split("?")[0];
    const target = clean ? path.join(path.dirname(f), clean) : f;
    if (!fs.existsSync(target)) { fail(`${f} -> ${u} (file not found)`); continue; }
    if (hash && target.endsWith(".html")) {
      const tIds = target === f ? ids : new Set([...fs.readFileSync(target, "utf8").matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));
      if (!tIds.has(hash)) fail(`${f} -> ${u} (anchor #${hash} not found)`);
    }
  }
}
// YouTube config: one entry per lesson, in order, titles matching lessons.json; any filled-in value must be a valid, unique video.
{
  const yt = JSON.parse(fs.readFileSync("data/youtube-ids.json", "utf8")), { parseYouTubeId } = require(path.resolve("netlify/functions/_lib/course"));
  if (yt.length !== lessons.length) fail("data/youtube-ids.json must have one entry per lesson");
  const used = new Map();
  yt.forEach((e, i) => {
    if (e.lesson !== i + 1 || e.title !== lessons[i].title) fail(`data/youtube-ids.json entry ${i + 1} does not match lesson ${i + 1} in lessons.json`);
    if (String(e.youtube || "").trim()) {
      const id = parseYouTubeId(e.youtube); if (!id) fail(`lesson ${e.lesson}: "${e.youtube}" is not a valid YouTube link/ID`);
      else if (used.has(id)) fail(`lesson ${e.lesson} and lesson ${used.get(id)} use the same YouTube video`); else used.set(id, e.lesson);
    }
  });
}
// No page may reference the removed login/signup/dashboard pages or the Supabase browser library.
for (const f of htmlFiles) {
  const src = fs.readFileSync(f, "utf8");
  if (/(login|signup|forgot|reset|dashboard|quiz)\.html/.test(src)) fail(`${f} links to a removed authentication page`);
  if (/<script[^>]*supabase/i.test(src)) fail(`${f} loads a Supabase script (the browser must not use it)`);
}
// The Terms version the checkout sends must match what the server accepts and what terms.html displays.
const ver = (fs.readFileSync("netlify/functions/_lib/course.js", "utf8").match(/TERMS_VERSION = "([^"]+)"/) || [])[1];
const chk = (fs.readFileSync("public/checkout.html", "utf8").match(/data-terms-version="([^"]+)"/) || [])[1];
const trm = fs.readFileSync("public/terms.html", "utf8");
if (!ver || ver !== chk) fail(`TERMS_VERSION (${ver}) in course.js must equal data-terms-version (${chk}) in checkout.html`);
if (!trm.includes(`version ${ver}`)) fail(`public/terms.html must show "version ${ver}"`);
if (!/id="agree"[^>]*type="checkbox"|type="checkbox"[^>]*id="agree"/.test(fs.readFileSync("public/checkout.html", "utf8")) || /id="agree"[^>]*\schecked/.test(fs.readFileSync("public/checkout.html", "utf8"))) fail("checkout.html needs an UNCHECKED #agree checkbox");
console.log(bad ? `\n${bad} problem(s) found` : `Structure OK: ${required.length} required files, ${htmlFiles.length} pages, all links and anchors resolve.`);
process.exit(bad ? 1 : 0);
