// SimpleHotelier — public booking requests, gated by Cloudflare Turnstile.
// POST { turnstile_token, booking: { p_tenant, p_check_in, p_check_out, ... } }
//   (anon key, from the booking page) -> the create_booking() result.
// Siteverify must confirm a real visitor first: success, action "booking",
// and a hostname on our own site. Anything else fails closed (403). Then
// create_booking() runs with the service role and the guest's IP for its
// per-connection throttle. Errors keep PostgREST's shape
// ({ message: code, details: sentence }) so the booking page shows them.
// Secrets: TURNSTILE_SECRET. Optional: TURNSTILE_HOSTNAMES (extra hostnames).
// Deploy: supabase functions deploy create-booking
import { createClient } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { SITE } from "../_shared/site.js";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ACTION = "booking";
const PARAMS = ["p_tenant", "p_check_in", "p_check_out", "p_name", "p_email", "p_room", "p_room_type", "p_guests",
  "p_phone", "p_requests", "p_addon_ids", "p_promo", "p_marketing_consent", "p_terms_accepted", "p_arrival_time",
  "p_children", "p_infants", "p_guest_address"];
const EXTRA_HOSTS = new Set((Deno.env.get("TURNSTILE_HOSTNAMES") || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));

/* Our booking page only: the platform domain, property subdomains, the
   config's extraOrigins (never localhost in production). */
const SITE_HOSTS = new Set(SITE.extraOrigins.map((o: string) => new URL(o).hostname));
function hostAllowed(hostname: unknown) {
  const h = String(hostname || "").toLowerCase();
  return h === SITE.domain || h.endsWith("." + SITE.domain) || SITE_HOSTS.has(h) || EXTRA_HOSTS.has(h);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refuse = () => json({ message: "verification_failed", details: "We couldn't confirm you're a person. Please try again." }, 403);

async function verified(token: unknown, ip: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret || typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    const result = await r.json();
    if (result.success === true && result.action === ACTION && hostAllowed(result.hostname)) return true;
    console.warn("create-booking: siteverify rejected", { codes: result["error-codes"], action: result.action, hostname: result.hostname });
    return false;
  } catch (e) {
    console.error("create-booking: siteverify unavailable", e); await logError("create-booking", e); // fail closed
    return false;
  }
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return json({ message: "method_not_allowed" }, 405);
  const ip = (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim();
  const body = await req.json().catch(() => ({}));
  if (!(await verified(body.turnstile_token, ip))) return refuse();

  const input = body.booking && typeof body.booking === "object" ? body.booking : {};
  const args: Record<string, unknown> = { p_client_ip: ip || null };
  for (const k of PARAMS) if (input[k] !== undefined) args[k] = input[k];
  try {
    const { data, error } = await admin.rpc("create_booking", args);
    if (error) {
      // create_booking raises with message = code, details = a guest-facing sentence.
      const known = /^[a-z_]+$/.test(error.message || "");
      if (!known) { console.error("create-booking rpc", error); await logError("create-booking", error, String(args.p_tenant || "")); }
      return json({ message: known ? error.message : "booking_failed", details: known ? error.details : "" }, 400);
    }
    return json(data);
  } catch (e) {
    console.error("create-booking", e); await logError("create-booking", e);
    return json({ message: "booking_failed", details: "" }, 500);
  }
}));
