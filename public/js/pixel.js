// Meta Pixel (public ID, not a secret). Loaded on public marketing/checkout pages only - NEVER on access.html (its URL carries the
// private course link) or lesson.html (paid content). Events: PageView (all), ViewContent (landing), InitiateCheckout (order created),
// Purchase (success page, once per purchase, live-mode only). No e-mail, token or private link is ever sent to Meta.
(function () {
  var ID = (window.SIN_CONFIG || {}).META_PIXEL_ID;
  if (!ID || /[#&]t=/.test(location.hash)) return;           // never run while a private token is in the address bar
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', ID);
  fbq('track', 'PageView');
  var page = (location.pathname.split('/').pop() || 'index').replace('.html', '') || 'index';
  var PRODUCT = { content_name: 'Digital Marketing Fundamentals', content_ids: ['digital-marketing-fundamentals'], content_type: 'product', value: 9999, currency: 'INR' };
  if (page === 'index') fbq('track', 'ViewContent', PRODUCT);
  window.SIN_PIXEL = {
    product: PRODUCT,
    initiateCheckout: function () { fbq('track', 'InitiateCheckout', PRODUCT); },
    // eventID = purchase reference, so Meta can de-duplicate if a server-side (Conversions API) event is added later.
    purchase: function (ref) {
      var key = 'sin_px_purchase_' + ref;
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) {}
      fbq('track', 'Purchase', PRODUCT, { eventID: 'purchase_' + ref });
    }
  };
})();
