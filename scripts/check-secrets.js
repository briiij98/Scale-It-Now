// Fails if anything that looks like a real secret is in files that get committed or served publicly.
const fs = require("fs"), path = require("path");
const SKIP = new Set(["node_modules", ".git", ".netlify"]);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => SKIP.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const rules = [
  [/rzp_live_[A-Za-z0-9]{8,}/, "Razorpay LIVE key id"],
  [/\brzp_test_[A-Za-z0-9]{8,}/, "Razorpay test key id"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase SECRET key"],
  [/(SECRET|SERVICE_ROLE_KEY|TOKEN_KEY|API_KEY|WEBHOOK_SECRET)[ \t]*[:=][ \t]*["']?[A-Za-z0-9_-]{16,}/, "secret assigned a value"],
];
let bad = 0;
// JWTs are fine ONLY if they are the public anon key (role "anon"). service_role or anything else is a leak.
const jwtRole = (t) => { try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).role || "unknown"; } catch (e) { return "undecodable"; } };
for (const f of walk(".").filter((x) => /\.(js|html|json|md|toml|sql|example|txt)$/.test(x) && !x.includes("package-lock") && !x.startsWith("test" + path.sep) && !x.startsWith("." + path.sep + "test" + path.sep) && !x.includes("verify-public-build.js") && !x.includes("_lib/assets.js"))) {
  const src = fs.readFileSync(f, "utf8");
  for (const [re, label] of rules) if (re.test(src)) { bad++; console.log("FAIL", f, "->", label); }
  for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g)) {
    const role = jwtRole(m[0]);
    if (role !== "anon") { bad++; console.log("FAIL", f, `-> JWT with role "${role}" (only the public anon key may appear in files)`); }
  }
}
if (fs.existsSync(".env")) { bad++; console.log("FAIL .env file exists in the project folder (it must never be uploaded)"); }
for (const f of walk("public")) { if (/service_role|RAZORPAY_KEY_SECRET|BUNNY_TOKEN_KEY/.test(fs.readFileSync(f).toString("latin1").slice(0, 400000)) && /\.(js|html)$/.test(f) && !/(config|auth)\.js$/.test(f)) { bad++; console.log("FAIL public file mentions a secret name:", f); } }
console.log(bad ? `\n${bad} problem(s)` : "No secrets found in committed/public files.");
process.exit(bad ? 1 : 0);
