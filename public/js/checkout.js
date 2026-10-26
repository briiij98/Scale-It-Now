// Checkout: validates name + e-mail, asks OUR server for a Razorpay order, opens Razorpay Checkout, then asks our server to verify.
(function () {
  const $ = (id) => document.getElementById(id);
  const form = $("coForm"), btn = $("payBtn"), msg = $("msg"), agree = $("agree");
  const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,59}$/, EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[A-Za-z]{2,}$/;
  const LABEL = "Pay ₹9,999";
  let busy = false;

  const setMsg = (t, kind) => { msg.textContent = t || ""; msg.className = kind || ""; };
  const setBusy = (on, label) => { busy = on; btn.disabled = on || !agree.checked; btn.setAttribute("aria-busy", on ? "true" : "false"); btn.textContent = on ? label : LABEL; $("name").disabled = $("email").disabled = agree.disabled = on; };
  const fieldErr = (id, text) => { const el = $(id), e = $(id + "Err"); e.textContent = text || ""; el.setAttribute("aria-invalid", text ? "true" : "false"); };
  function validate() {
    const name = $("name").value.trim().replace(/\s+/g, " "), email = $("email").value.trim().toLowerCase();
    fieldErr("name", NAME_RE.test(name) ? "" : "Enter your full name using English letters (it is printed on your certificate).");
    fieldErr("email", email.length <= 254 && EMAIL_RE.test(email) ? "" : "Enter a valid email address.");
    const bad = !NAME_RE.test(name) ? $("name") : !(email.length <= 254 && EMAIL_RE.test(email)) ? $("email") : null;
    if (bad) { bad.focus(); return null; }
    if (!agree.checked) { setMsg("Please tick the box to accept the Terms & Conditions before paying.", "err"); agree.focus(); return null; }
    return { name, email };
  }

  const loadRazorpay = () => new Promise((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = res; s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  });
  const post = async (fn, body) => {
    const r = await fetch("/.netlify/functions/" + fn, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Ask the server to verify. Pending payments are re-checked (the call is idempotent) for up to ~75 seconds.
  async function verify(resp) {
    setBusy(true, "Confirming your payment…"); setMsg("Confirming your payment… please do not close this page.");
    for (let i = 0; i < 25; i++) {
      let r;
      try { r = await post("verify-payment", resp); } catch (e) { r = null; }
      if (r && r.ok && r.data.status === "paid") {
        if (r.data.token) window.SIN_ACCESS.set(r.data.token);
        try { sessionStorage.setItem("sin_just_paid", "1"); } catch (e) {}
        location.href = "success.html";
        return;
      }
      if (r && r.status === 402) { setBusy(false); return setMsg(r.data.error || "The payment failed. Please try again.", "err"); }
      if (r && r.status >= 400 && r.status !== 202 && r.status < 500 && r.status !== 429) { setBusy(false); return setMsg((r.data.error || "We could not verify the payment.") + " Reference: " + resp.razorpay_payment_id, "err"); }
      await sleep(3000); // network error, 5xx or still pending: try again
    }
    setBusy(false);
    setMsg("Your payment was received but is still being confirmed. Please do NOT pay again. Open “Access my course” in a few minutes with your email and payment ID " + resp.razorpay_payment_id + ", or contact support.", "err");
  }

  async function start(e) {
    e.preventDefault();
    if (busy) return;                                    // double-click / double-Enter guard
    const v = validate(); if (!v) return;
    setMsg(""); setBusy(true, "Preparing secure payment…");
    try { await loadRazorpay(); } catch (err) { setBusy(false); return setMsg("Could not load the payment window. Check your internet connection (or disable ad-blockers for this site) and try again.", "err"); }
    let o;
    try { o = await post("create-order", { name: v.name, email: v.email, acceptedTerms: true, termsVersion: agree.dataset.termsVersion }); }
    catch (err) { setBusy(false); return setMsg("Could not reach the server. Check your internet connection and try again.", "err"); }
    if (!o.ok) {
      setBusy(false);
      if (o.status === 409) { setMsg(o.data.error, "err"); $("recoverLink").hidden = false; return; }
      return setMsg(o.data.error || "Could not start payment. Please try again in a moment.", "err");
    }
    const d = o.data;
    if (d.mode === "live" && window.SIN_PIXEL) window.SIN_PIXEL.initiateCheckout();
    if (d.mode === "test") $("testBanner").hidden = false;
    setBusy(true, "Waiting for payment…"); setMsg("Complete the payment in the Razorpay window.");
    let opened = false;
    const rz = new window.Razorpay({
      key: d.keyId, order_id: d.orderId, amount: d.amount, currency: d.currency,
      name: "Scale It Now", description: "Digital Marketing Fundamentals",
      prefill: { name: d.name, email: d.email }, theme: { color: "#5b21b6" },
      modal: { ondismiss: () => { if (!opened) { setBusy(false); setMsg("Payment cancelled. You have not been charged. You can try again whenever you are ready."); } } },
      handler: (resp) => { opened = true; verify(resp); },
    });
    rz.on("payment.failed", (ev) => setMsg("Payment failed: " + ((ev.error && ev.error.description) || "please try again.") + " You can retry in the payment window.", "err"));
    rz.open();
  }

  const sync = () => { btn.disabled = busy || !agree.checked; $("agreeHint").hidden = agree.checked; };
  agree.addEventListener("change", () => { sync(); if (agree.checked) setMsg(""); });
  window.addEventListener("pageshow", () => { agree.checked = false; busy = false; sync(); });  // always start unticked (back button / reload)
  form.addEventListener("submit", start);
  sync();
})();
