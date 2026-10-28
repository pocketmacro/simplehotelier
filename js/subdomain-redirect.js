/* SimpleHotelier — property subdomains ({slug}.{platform domain}, from
   js/site.js) are booking pages, not the marketing site: bounce straight to
   that property's booking page. Loaded first in index.html <head>, right
   after js/site.js (a file, not inline, so the Content-Security-Policy can
   forbid inline scripts). */
(function () {
  var site = window.SH_SITE || {};
  if (!site.domain || !site.bookingSubdomains) return;
  var h = location.hostname.toLowerCase(), suffix = "." + site.domain;
  if (h.endsWith(suffix)) {
    var label = h.slice(0, -suffix.length);
    if (label && label.indexOf(".") === -1 && label !== "www" && /^[a-z0-9-]+$/.test(label)) {
      var q = new URLSearchParams(location.search);
      q.set("property", label);
      location.replace("/book.html?" + q.toString());
    }
  }
})();
