const input = document.getElementById("id"), out = document.getElementById("result");
const add = (p, tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; p.appendChild(e); return e; };

async function check(id) {
  out.replaceChildren();
  try {
    const r = await fetch("/.netlify/functions/verify-certificate?id=" + encodeURIComponent(id));
    const d = await r.json();
    if (!d.valid) return add(out, "div", "No certificate found for this ID. Check the ID and try again.", "bad");
    const box = add(out, "div", "", "ok");
    add(box, "b", "Valid certificate");
    const dl = add(box, "dl", "");
    [["Name", d.name], ["Course", d.course], ["Issued on", new Date(d.issuedOn + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })], ["Certificate ID", d.certId]]
      .forEach(([k, v]) => { add(dl, "dt", k); add(dl, "dd", v); });
  } catch (e) { add(out, "div", "Could not check right now. Please try again.", "bad"); }
}
document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); if (input.value.trim()) check(input.value.trim()); });
const q = new URLSearchParams(location.search).get("id");
if (q) { input.value = q; check(q); }
