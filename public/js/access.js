// Passwordless course access. The secret token lives in the URL FRAGMENT of the private link (#t=...), which browsers never send to
// servers or in Referer headers. It is kept in localStorage only as a convenience: the SERVER checks it on every protected call,
// so editing localStorage cannot unlock anything.
(function () {
  const KEY = "sin_access_token", TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  const get = () => { try { const t = localStorage.getItem(KEY); return TOKEN_RE.test(t || "") ? t : ""; } catch (e) { return ""; } };
  const set = (t) => { try { localStorage.setItem(KEY, t); } catch (e) {} };
  const clear = () => { try { localStorage.removeItem(KEY); } catch (e) {} };
  // Picks up a token from #t=... (then removes it from the address bar).
  function fromHash() {
    const m = /(?:^#|&)t=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || "");
    if (!m) return "";
    set(m[1]);
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }
  async function api(name, opts) {
    const token = get();
    if (!token) return { status: 401, ok: false, noToken: true, json: async () => ({}) };
    try {
      const res = await fetch("/.netlify/functions/" + name, { ...(opts || {}), headers: { ...((opts && opts.headers) || {}), Authorization: "Bearer " + token } });
      if (res.status === 401) clear();
      return res;
    } catch (e) { return null; } // network error: callers show a friendly message
  }
  const link = () => { const t = get(); return t ? location.origin + "/access.html#t=" + t : ""; };
  window.SIN_ACCESS = { get, set, clear, fromHash, api, link };
})();
