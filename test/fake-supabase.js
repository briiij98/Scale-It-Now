// In-memory stand-in for @supabase/supabase-js, used ONLY by test/run.js (no network, no real database).
// Models what the migration enforces: UNIQUE constraints and the exact semantics of conditional updates.
const UNIQUE = {
  purchases: [["razorpay_order_id"], ["razorpay_payment_id"]],
  access_tokens: [["token_hash"]],
  certificates: [["cert_id"], ["purchase_id"]],
};
const store = { tables: {}, failNext: null };
const rows = (t) => (store.tables[t] = store.tables[t] || []);
let seq = 0;

class Query {
  constructor(t) { this.t = t; this.filters = []; this.op = "select"; this.orderBy = null; this.lim = null; this.mode = null; this.returning = false; }
  select(_c, o = {}) { this.returning = true; this.wantCount = !!o.count; this.head = !!o.head; return this; }
  insert(v) { this.op = "insert"; this.v = v; return this; }
  update(v) { this.op = "update"; this.v = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push([c, v, "eq"]); return this; }
  neq(c, v) { this.filters.push([c, v, "neq"]); return this; }
  is(c, v) { this.filters.push([c, v, "is"]); return this; }
  gte(c, v) { this.filters.push([c, v, "gte"]); return this; }
  order(c, o = {}) { this.orderBy = [c, o.ascending !== false]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "one"; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  matches(r) {
    return this.filters.every(([c, v, op]) => {
      const x = r[c] === undefined ? null : r[c];
      if (op === "eq") return x === v;
      if (op === "neq") return x !== v;
      if (op === "is") return x === v;
      if (op === "gte") return x !== null && String(x) >= String(v);
    });
  }
  finish(out) {
    if (this.mode === "maybe") return { data: out[0] || null, error: null };
    if (this.mode === "one") return out[0] ? { data: out[0], error: null } : { data: null, error: { message: "no rows" } };
    return { data: out, error: null };
  }
  violates(t, row, ignore) {
    return (UNIQUE[this.t] || []).some((cols) => cols.every((c) => row[c] != null) && t.some((r) => r !== ignore && cols.every((c) => r[c] === row[c])));
  }
  run() {
    if (store.failNext && store.failNext.table === this.t && store.failNext.op === this.op) { const e = store.failNext.error; store.failNext = null; return { data: null, error: e }; }
    const t = rows(this.t);
    if (this.op === "select") {
      let out = t.filter((r) => this.matches(r)).map((r) => ({ ...r }));
      if (this.orderBy) out.sort((a, b) => (a[this.orderBy[0]] > b[this.orderBy[0]] ? 1 : -1) * (this.orderBy[1] ? 1 : -1));
      const total = out.length;
      if (this.lim) out = out.slice(0, this.lim);
      if (this.wantCount) return { data: this.head ? null : out, count: total, error: null };
      return this.finish(out);
    }
    if (this.op === "insert") {
      const made = [];
      for (const it of Array.isArray(this.v) ? this.v : [this.v]) {
        const row = { id: "id" + ++seq, created_at: new Date().toISOString(), ...it };
        if (this.t === "purchases") { row.status = row.status || "created"; row.currency = row.currency || "INR"; }
        if (this.violates(t, row)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        t.push(row); made.push({ ...row });
      }
      return this.returning ? this.finish(made) : { data: null, error: null };
    }
    if (this.op === "update") {
      const hit = t.filter((r) => this.matches(r));
      for (const r of hit) { const next = { ...r, ...this.v }; if (this.violates(t, next, r)) return { data: null, error: { code: "23505", message: "duplicate key" } }; Object.assign(r, this.v); }
      return this.returning ? this.finish(hit.map((r) => ({ ...r }))) : { data: null, error: null };
    }
    if (this.op === "delete") { store.tables[this.t] = t.filter((r) => !this.matches(r)); return { data: null, error: null }; }
  }
}
const createClient = () => ({ from: (t) => new Query(t) });
const reset = () => { store.tables = {}; store.failNext = null; };
module.exports = { createClient, store, rows, reset };
