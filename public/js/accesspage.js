(async function () {
  const $ = (id) => document.getElementById(id);
  const A = window.SIN_ACCESS;
  A.fromHash();
  if (A.get()) {
    const r = await A.api("get-purchase");
    if (r && r.ok) { location.replace("success.html?back=1"); return; }
    if (r && r.status !== 401) { $("state").textContent = "Could not reach the server. Please refresh in a moment."; return; }
  }
  $("state").hidden = true; $("recover").hidden = false;
  const msg = (t, k) => { $("rMsg").textContent = t; $("rMsg").className = k || ""; };
  $("rForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("rBtn"); btn.disabled = true; msg("Checking…");
    try {
      const res = await fetch("/.netlify/functions/recover-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("rEmail").value, paymentId: $("rPay").value }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.token) { A.set(d.token); location.replace("success.html?back=1"); return; }
      msg(d.message || d.error || "Something went wrong. Please try again.", res.ok ? "" : "err");
    } catch (err) { msg("Could not reach the server. Check your connection and try again.", "err"); }
    btn.disabled = false;
  });
})();
