/* SimpleHotelier — report uncaught browser errors so problems guests and
   owners hit show up in System Admin (log_client_error -> client_errors).
   Only errors from our own scripts (not extensions or blocked third-party
   scripts), each distinct message once, at most 5 per page view. Reports
   carry the page path and property, never form contents. */
(function () {
  "use strict";
  const cfg = window.SH_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.fetch) return;

  const path = location.pathname;
  const page = /\/book(\.html)?$/.test(path) ? "book"
    : /\/app(\.html)?$/.test(path) ? "app"
    : /^\/(index(\.html)?)?$/.test(path) ? "landing" : "other";
  /* Connection drops and blocked third-party scripts aren't bugs we can fix. */
  const NOISE = /^(Script error\.?|Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The operation was aborted\.?)$/i;
  const seen = new Set();
  let sent = 0;

  const ours = (src) => {
    if (!src) return true;
    try { return new URL(src, location.href).origin === location.origin; } catch { return false; }
  };

  function report(message, source, stack) {
    const msg = String(message || "").trim().slice(0, 500);
    if (!msg || NOISE.test(msg.replace(/^Unhandled rejection: /, "")) || /extension:\/\//.test(String(stack || ""))) return;
    if (sent >= 5 || seen.has(msg)) return;
    seen.add(msg);
    sent++;
    const property = new URLSearchParams(location.search).get("property");
    fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/log_client_error", {
      method: "POST",
      keepalive: true,
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_page: page,
        p_message: msg,
        p_source: source || null,
        p_stack: stack ? String(stack).slice(0, 4000) : null,
        p_url: path + (property ? "?property=" + encodeURIComponent(property.slice(0, 63)) : ""),
        p_tenant: window.SH_TENANT_ID || null
      })
    }).catch(() => { /* never let reporting fail loudly */ });
  }

  window.addEventListener("error", (e) => {
    if (!e || !e.message || !ours(e.filename)) return; // resource load errors carry no message
    report(e.message, e.filename ? e.filename.replace(location.origin, "") + ":" + e.lineno + ":" + e.colno : "", e.error && e.error.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    report("Unhandled rejection: " + (r && r.message ? r.message : String(r)), "", r && r.stack);
  });
  /* For failures the page catches but we still want to know about. */
  window.SHReportError = (err, context) =>
    report((context ? context + ": " : "") + (err && err.message ? err.message : String(err)), "", err && err.stack);
})();
