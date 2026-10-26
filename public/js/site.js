// Shared by every page: footer year, support e-mail, social links, mobile menu.
(function () {
  const c = window.SIN_CONFIG || {};
  document.querySelectorAll("[data-year]").forEach((e) => (e.textContent = new Date().getFullYear()));
  document.querySelectorAll("[data-support-email]").forEach((e) => {
    if (c.SUPPORT_EMAIL) { e.textContent = c.SUPPORT_EMAIL; if (e.tagName === "A") e.href = "mailto:" + c.SUPPORT_EMAIL; }
  });
  const social = c.SOCIAL || {};
  document.querySelectorAll("[data-social]").forEach((a) => { if (social[a.dataset.social]) a.href = social[a.dataset.social]; else a.remove(); });
  const toggle = document.getElementById("navToggle"), nav = document.getElementById("nav");
  if (toggle && nav) toggle.addEventListener("click", () => { toggle.setAttribute("aria-expanded", nav.classList.toggle("open")); });
})();
