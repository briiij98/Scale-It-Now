(async function () {
  const $ = (id) => document.getElementById(id);
  const A = window.SIN_ACCESS;
  A.fromHash();
  if (new URLSearchParams(location.search).get("back") === "1") { $("h1").textContent = "Welcome back"; }
  const r = await A.api("get-purchase");
  if (!r) { $("state").textContent = "Could not reach the server. Check your internet connection and refresh."; return; }
  if (r.status === 401) {
    $("state").hidden = true;
    if (r.noToken && !sessionStorage.getItem("sin_just_paid")) { location.replace("access.html"); return; }
    $("lost").hidden = false; return;
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { $("state").textContent = d.error || "Could not load your course. Please refresh."; return; }
  $("state").hidden = true; $("ready").hidden = false;
  $("vName").textContent = d.name; $("vCourse").textContent = d.course; $("vLessons").textContent = d.lessonCount + " video lessons · lifetime access";
  $("vCert").textContent = d.certificateId; $("vVerify").href = "verify.html?id=" + encodeURIComponent(d.certificateId);
  $("linkBox").value = A.link(); $("mailNote").textContent = "";
  if (d.testMode) $("testBanner").hidden = false;
  // Meta Purchase: only right after a real (live-mode) payment in this browser, once per purchase; never for test payments or returning visits.
  let fresh = false; try { fresh = sessionStorage.getItem("sin_just_paid") === "1"; } catch (e) {}
  if (fresh && !d.testMode && window.SIN_PIXEL) window.SIN_PIXEL.purchase(d.certificateId);
  $("copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText($("linkBox").value); $("copyBtn").textContent = "Copied ✓"; }
    catch (e) { $("linkBox").select(); $("copyBtn").textContent = "Press Ctrl+C"; }
  };
  $("certBtn").onclick = async () => {
    const b = $("certBtn"); b.disabled = true; $("certMsg").textContent = "Preparing your certificate…";
    const c = await A.api("generate-certificate");
    if (!c || !c.ok) { b.disabled = false; $("certMsg").textContent = "Could not prepare the certificate. Please try again."; return; }
    const blob = await c.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = d.certificateId + ".pdf"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    b.disabled = false; $("certMsg").textContent = "Certificate downloaded.";
  };
})();
