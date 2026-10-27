/* SimpleHotelier — money in the property's currency.
   Shared by the dashboard (app.html) and the guest page (book.html).
   Every amount is stored in cents, so only two-decimal currencies are
   offered; the database allows the same list (tenants_currency_supported). */
(function () {
  "use strict";

  const CURRENCIES = {
    USD: "US dollar", CAD: "Canadian dollar", MXN: "Mexican peso",
    EUR: "Euro", GBP: "British pound", CHF: "Swiss franc",
    SEK: "Swedish krona", NOK: "Norwegian krone", DKK: "Danish krone",
    AUD: "Australian dollar", NZD: "New Zealand dollar", ZAR: "South African rand",
    SGD: "Singapore dollar", HKD: "Hong Kong dollar"
  };
  const code = (c) => { const k = String(c || "").toUpperCase(); return CURRENCIES[k] ? k : "USD"; };

  const cache = {};
  function fmt(c, whole) {
    const k = c + (whole ? ":0" : ":2");
    return cache[k] || (cache[k] = new Intl.NumberFormat("en-US", {
      style: "currency", currency: c, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2
    }));
  }
  /* format(1234.5, "USD") -> "$1,234.50", "EUR" -> "€1,234.50", "CAD" -> "CA$1,234.50".
     { short: true } drops ".00" on whole amounts ($295, $14.50). */
  function format(n, currency, opts) {
    const v = Number(n) || 0;
    const whole = !!(opts && opts.short) && Number.isInteger(Math.round(v * 100) / 100);
    return fmt(code(currency), whole).format(v);
  }
  /* "$", "€", "CA$"… for labels such as "Amount ($)". */
  function symbol(currency) {
    const part = fmt(code(currency), true).formatToParts(0).find((p) => p.type === "currency");
    return part ? part.value : code(currency);
  }

  window.SHMoney = { CURRENCIES, code, format, symbol };
})();
