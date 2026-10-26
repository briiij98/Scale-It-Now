// PUBLIC values only (this file is served to every visitor). No keys or secrets belong here - the site needs none in the browser.
window.SIN_CONFIG = {
  SUPPORT_EMAIL: "inquiries.scale.it.now@gmail.com",
  // Display only. The amount actually charged is fixed on the server (netlify/functions/_lib/razorpay.js).
  PRICE_INR: 9999,
  // Meta Pixel ID (public). Remove or leave empty to switch tracking off.
  META_PIXEL_ID: "2231897204023745",
  // Optional social links, e.g. { instagram: "https://instagram.com/yourpage", youtube: "...", linkedin: "...", whatsapp: "..." }
  SOCIAL: {}
};
