const db = require("./_lib/supabase"), { dbError } = require("./_lib/supabase");
const { json, fail } = require("./_lib/http");

// Public on purpose: anyone with a certificate ID can check it. Returns only name, course, issue date.
// A certificate whose purchase was refunded/revoked is reported as not valid.
exports.handler = async (event) => {
  const id = ((event.queryStringParameters || {}).id || "").trim().toUpperCase();
  if (!/^SIN-\d{4}-[A-HJ-NP-Z2-9]{8}$/.test(id)) return json(200, { valid: false });
  try {
    const { data, error } = await db().from("certificates").select("cert_id,student_name,course_title,completed_on,purchase_id").eq("cert_id", id).maybeSingle();
    if (error) throw dbError(error, "verify certificate");
    if (!data) return json(200, { valid: false });
    if (data.purchase_id) {
      const { data: p } = await db().from("purchases").select("status,revoked_at").eq("id", data.purchase_id).maybeSingle();
      if (!p || p.status !== "paid" || p.revoked_at) return json(200, { valid: false });
    }
    return json(200, { valid: true, certId: data.cert_id, name: data.student_name, course: data.course_title, issuedOn: data.completed_on });
  } catch (e) { return fail("verify-certificate", e); }
};
