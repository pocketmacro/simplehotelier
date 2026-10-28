// SimpleHotelier — CORS for browser-called Edge Functions: only our own sites
// (the platform domain, property subdomains, site.config.json extraOrigins,
// localhost for development, ALLOWED_ORIGINS) get a CORS grant. Requests
// without an Origin (Stripe, cron, other functions) are unaffected.
import { isOwnOrigin } from "./origin.js";

const BASE = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const extra = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",");
  return origin && isOwnOrigin(origin, extra) ? origin : null;
}

/* Wrap a handler: answers preflights and sets Access-Control-Allow-Origin on
   every response for our origins only (overriding any "*" a handler set). */
export function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const allow = allowedOrigin(req);
    const cors: Record<string, string> = { ...BASE, ...(allow ? { "Access-Control-Allow-Origin": allow } : {}) };
    if (req.method === "OPTIONS") return new Response(allow ? "ok" : "origin not allowed", { status: allow ? 200 : 403, headers: cors });
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.delete("Access-Control-Allow-Origin");
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
