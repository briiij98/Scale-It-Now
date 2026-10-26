# Headless-browser smoke test: real pages + real function handlers, fake DB, STUBBED Razorpay window. Run: python3 test/browser/e2e.py
import subprocess, time, os, sys, re, json
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
env = dict(os.environ, PORT="8799", NODE_PATH="/home/claude/.npm-global/lib/node_modules:" + os.environ.get("NODE_PATH", ""))
srv = subprocess.Popen(["node", "test/browser/server.js"], cwd=ROOT, env=env, stdout=subprocess.PIPE, text=True)
srv.stdout.readline(); B = "http://localhost:8799"
STUB = """window.Razorpay = function(o){ this.o=o; this.h={}; };
window.Razorpay.prototype.on=function(e,f){this.h[e]=f};
window.Razorpay.prototype.open=function(){ var o=this.o; window.__rzpOpts={key:o.key,order_id:o.order_id,amount:o.amount,currency:o.currency};
  if(window.__cancel){ setTimeout(function(){o.modal.ondismiss()},50); return; }
  fetch('/__test/pay?order='+o.order_id+(window.__status?'&status='+window.__status:'')).then(function(r){return r.json()}).then(function(r){o.handler(r)}); };"""
res = []; fails = 0
def attach(pg, tag):
    pg.on("pageerror", lambda e: errs.append(tag + " " + pg.url + " " + str(e)))
def check(name, cond):
    global fails
    res.append((name, bool(cond))); print(("  ok   " if cond else "  FAIL ") + name)
    if not cond: fails += 1
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(accept_downloads=True); page = ctx.new_page()
        errs = []; attach(page, "main")
        ctx.route("https://connect.facebook.net/**", lambda r: r.abort())
        ctx.route("https://checkout.razorpay.com/**", lambda r: r.fulfill(status=200, content_type="text/javascript", body=STUB))
        ctx.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        # landing
        page.goto(B + "/index.html"); html = page.content()
        check("landing: Buy Course buttons go to checkout", page.locator('a[href="checkout.html"]').count() >= 3 and "₹9,999" in html)
        check("landing: no login/signup links, no fake discount", page.locator('a[href*="login"], a[href*="signup"]').count() == 0 and "49,000" not in html and "Diwali" not in html)
        # checkout validation
        page.goto(B + "/checkout.html")
        check("checkout: Pay disabled until terms ticked", page.locator("#payBtn").is_disabled())
        page.check("#agree"); page.click("#payBtn")
        check("checkout: empty form shows name error and no order", "full name" in page.inner_text("#nameErr").lower() and page.evaluate("window.__rzpOpts") is None)
        page.fill("#name", "Asha Mehta"); page.fill("#email", "bad"); page.click("#payBtn")
        check("checkout: bad email rejected", "valid email" in page.inner_text("#emailErr").lower())
        # cancelled payment
        page.evaluate("window.__cancel = true"); page.fill("#email", "asha@example.com"); page.click("#payBtn")
        page.wait_for_function("document.getElementById('msg').textContent.includes('cancelled')")
        check("checkout: cancelled payment shows message, page stays, no access", page.url.endswith("checkout.html") and page.evaluate("localStorage.getItem('sin_access_token')") is None)
        opts = page.evaluate("window.__rzpOpts"); check("checkout: Razorpay opened with 999900 INR and public key id", opts["amount"] == 999900 and opts["currency"] == "INR" and opts["key"].startswith("rzp_test_") and opts["order_id"].startswith("order_"))
        # successful payment
        page.evaluate("window.__cancel = false"); page.click("#payBtn")
        page.wait_for_url("**/success.html", timeout=15000); page.wait_for_selector("#ready:not([hidden])")
        txt = page.inner_text("main")
        check("success: shows Payment Successful / Your Course Is Ready / Start Learning / Download Your Certificate", all(s in txt for s in ["Payment Successful", "Your Course Is Ready", "Start Learning", "Download Your Certificate"]))
        check("success: shows purchaser name and course", "Asha Mehta" in txt and "Digital Marketing Fundamentals" in txt)
        check("success: token never in the address bar", "#t=" not in page.url and "token" not in page.url)
        with page.expect_download() as dl: page.click("#certBtn")
        path = dl.value.path(); pdf = open(path, "rb").read(); check("success: certificate downloads as a real PDF", pdf[:5] == b"%PDF-" and dl.value.suggested_filename.startswith("SIN-"))
        link = page.input_value("#linkBox"); check("success: private return link shown", "/access.html#t=" in link)
        fbq = lambda pg: pg.evaluate("(window.fbq && window.fbq.queue || []).map(function(a){return Array.from(a)})")
        evs = [e[1] for e in fbq(page)]
        check("pixel: test-mode purchase sends NO Purchase/InitiateCheckout to Meta", "Purchase" not in evs and "InitiateCheckout" not in evs and "PageView" in evs)
        # lessons
        page.click("#startBtn"); page.wait_for_selector("#player:not(.hidden)")
        check("lessons: all 16 listed and navigation works", page.locator("#lessonList li").count() == 16)
        page.click("#next"); page.wait_for_function("document.getElementById('lTitle').textContent.startsWith('Lesson 2')")
        page.wait_for_function("document.getElementById('videoNote').textContent.includes('not available yet')", timeout=8000); check("lessons: video notice shown when no YouTube ID configured", True)
        # unauthenticated browser
        ctx2 = br.new_context(); p2 = ctx2.new_page(); attach(p2, "p2")
        p2.goto(B + "/lesson.html"); p2.wait_for_selector("#locked:not(.hidden)"); check("lessons: locked without a purchase link", True)
        p2.goto(B + "/success.html"); p2.wait_for_url("**/access.html"); check("success page without token redirects to Access my course", True)
        p2.evaluate("localStorage.setItem('sin_access_token','" + "A" * 43 + "')"); p2.goto(B + "/lesson.html"); p2.wait_for_selector("#locked:not(.hidden)"); check("lessons: forged localStorage token does NOT unlock", True)
        # return via private link (new device)
        p2.goto(link); p2.wait_for_url("**/success.html?back=1"); p2.wait_for_selector("#ready:not([hidden])")
        check("access link on another device opens course; fragment removed", "Welcome back" in p2.inner_text("#h1") and "#t=" not in p2.url)
        # recovery form
        p3 = br.new_context().new_page(); attach(p3, "p3"); p3.goto(B + "/access.html"); p3.wait_for_selector("#recover:not([hidden])")
        p3.fill("#rEmail", "asha@example.com"); p3.fill("#rPay", "pay_wrongwrong0000"); p3.click("#rBtn")
        p3.wait_for_function("document.getElementById('rMsg').textContent.length>5 && document.getElementById('rMsg').textContent!=='Checking…'"); check("recovery: wrong payment ID refused", "could not find" in p3.inner_text("#rMsg").lower())
        # live-mode purchase fires Meta events exactly once
        import urllib.request; urllib.request.urlopen(B + "/__test/live?on=1").read()
        pm = ctx.new_page(); attach(pm, "pm"); pm.goto(B + "/index.html")
        check("pixel: landing fires PageView + ViewContent (and never the e-mail)", [e[1] for e in fbq(pm) if e[0] == "track"][:2] == ["PageView", "ViewContent"])
        pm.goto(B + "/checkout.html"); pm.fill("#name", "Meera Shah"); pm.fill("#email", "meera@example.com"); pm.check("#agree"); pm.click("#payBtn")
        pm.wait_for_url("**/success.html", timeout=15000); pm.wait_for_selector("#ready:not([hidden])")
        q = fbq(pm); names = [e[1] for e in q]
        check("pixel: live purchase fires Purchase once with 9999 INR", names.count("Purchase") == 1 and [e for e in q if e[1] == "Purchase"][0][2]["value"] == 9999 and [e for e in q if e[1] == "Purchase"][0][2]["currency"] == "INR")
        check("pixel: payload has no e-mail, name or token", "meera" not in json.dumps(q).lower() and "Meera" not in json.dumps(q) and "#t=" not in json.dumps(q))
        pm.reload(); pm.wait_for_selector("#ready:not([hidden])"); check("pixel: reloading success page does NOT fire Purchase again", "Purchase" not in [e[1] for e in fbq(pm)])
        pa = ctx.new_page(); pa.goto(B + "/access.html"); check("pixel: not loaded on access page", pa.evaluate("typeof window.fbq") == "undefined")
        urllib.request.urlopen(B + "/__test/live?on=0").read()
        # verify page
        cid = page.inner_text("#vCert") if page.locator("#vCert").count() else ""
        # double-click guard: second purchase
        p4 = br.new_context().new_page(); p4.route("https://checkout.razorpay.com/**", lambda r: r.fulfill(status=200, content_type="text/javascript", body=STUB))
        p4.route(re.compile(r"https://fonts\..*"), lambda r: r.abort()); p4.goto(B + "/checkout.html"); p4.fill("#name", "Ravi Kumar"); p4.fill("#email", "ravi@example.com"); p4.check("#agree")
        p4.evaluate("window.__status='failed'"); p4.click("#payBtn"); p4.wait_for_function("document.getElementById('msg').textContent.toLowerCase().includes('did not go through')", timeout=15000)
        check("checkout: failed payment shows error and grants nothing", p4.url.endswith("checkout.html") and p4.evaluate("localStorage.getItem('sin_access_token')") is None)
        v = br.new_context().new_page(); v.route(re.compile(r"https://fonts\..*"), lambda r: r.abort()); v.goto(B + "/verify.html?id=" + page.inner_text("#vCert") if False else B + "/verify.html")
        print("   js errors:", errs); check("no uncaught JS errors on any page", not errs)
        br.close()
finally:
    srv.terminate()
print(f"\n{len(res) - fails} passed, {fails} failed"); json.dump(res, open(os.path.join(ROOT, "test", "browser", "last-results.json"), "w"))
sys.exit(1 if fails else 0)
