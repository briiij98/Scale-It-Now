const { createClient } = require("@supabase/supabase-js");
const { AppError } = require("./http");
let client, clientKey;
// Service-role client: SERVER ONLY (it bypasses Row Level Security). Never import this from anything under public/.
// Pasted values often carry quotes, spaces, a trailing slash, a /rest/v1 suffix or no https:// - clean them up instead of failing.
const clean = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
function normUrl(v) {
  let u = clean(v); if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try { return new URL(u).origin; } catch (e) { throw new AppError("config_supabase", 503, "The store is temporarily unavailable. Please contact support.", "SUPABASE_URL is not a valid URL; it must look like https://YOUR-PROJECT-REF.supabase.co"); }
}
function db() {
  {
    const SUPABASE_URL = normUrl(process.env.SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const missing = [!SUPABASE_URL && "SUPABASE_URL", !SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
    if (missing.length) throw new AppError("config_supabase", 503, "The store is temporarily unavailable. Please contact support.", "Missing environment variable(s): " + missing.join(", "));
    if (!client || clientKey !== SUPABASE_URL + "|" + SUPABASE_SERVICE_ROLE_KEY) { client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); clientKey = SUPABASE_URL + "|" + SUPABASE_SERVICE_ROLE_KEY; }
  }
  return client;
}
// Turns a Supabase/PostgREST error into an AppError with a helpful server-side hint.
function dbError(error, what) {
  const msg = (error && error.message) || "unknown";
  const schema = (error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || error.code === "PGRST204")) || /does not exist|schema cache/i.test(msg);
  if (schema) return new AppError("db_schema", 503, "The store is temporarily unavailable. Please contact support.", `${what}: database tables/columns missing - run SUPABASE_MIGRATION.sql (${msg})`);
  if (error && error.code === "PGRST301" || /invalid api key|jwt/i.test(msg)) return new AppError("db_auth", 503, "The store is temporarily unavailable. Please contact support.", `${what}: Supabase rejected SUPABASE_SERVICE_ROLE_KEY (${msg})`);
  return new AppError("db_error", 500, "Something went wrong on our side. Please try again in a moment.", `${what}: ${msg}`);
}
module.exports = db; module.exports.dbError = dbError;
