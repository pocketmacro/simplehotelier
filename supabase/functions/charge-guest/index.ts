// SimpleHotelier — booking deposits on the property's connected Stripe account.
// POST { tenant_id, reservation_id }
//   -> { client_secret, payment_intent_id, amount_cents }
// The amount never comes from the browser: it is the property's deposit
// percent of the total that create_booking() priced server-side, and only
// for a fresh, unpaid, online booking request.
// POST { action: "confirm", tenant_id, payment_intent_id } -> { paid, status }
// The browser confirms the PaymentIntent with Stripe.js (publishable key);
// confirm re-reads it from Stripe and records it once (record_stripe_payment).
// stripe-webhook records the same payment if the browser never comes back.
// Deploy: supabase functions deploy charge-guest
// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_FEE_PERCENT = 1.0; // SimpleHotelier platform fee — tune per plan.
const REQUEST_TTL_MS = 24 * 3600e3; // deposit must be paid within a day of the request
const OPEN_STATUSES = ["requires_payment_method", "requires_confirmation", "requires_action"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* Status comes from Stripe itself, never the browser; recording is idempotent. */
async function recordIfSucceeded(intent: any) {
  if (!intent || intent.status !== "succeeded") return false;
  const { error } = await admin.rpc("record_stripe_payment", { p_intent: intent.id });
  if (error) throw new Error(error.message);
  return true; // recorded now, or already recorded earlier
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenant_id || "");
    if (!tenantId) return json({ error: "tenant_id required" }, 400);
    const { data: tenant } = await admin.from("tenants")
      .select("id, currency, stripe_account_id, stripe_onboarding_complete, deposit_enabled, deposit_percent")
      .eq("id", tenantId).maybeSingle();
    if (!tenant?.stripe_account_id) return json({ error: "property has not connected Stripe" }, 400);
    const stripeAccount = tenant.stripe_account_id as string;

    if (body.action === "confirm") {
      if (!body.payment_intent_id) return json({ error: "payment_intent_id required" }, 400);
      const intent = await stripe.paymentIntents.retrieve(String(body.payment_intent_id), {}, { stripeAccount });
      if (intent.metadata?.tenant_id !== tenant.id) return json({ error: "payment does not belong to this property" }, 403);
      const paid = await recordIfSucceeded(intent);
      return json({ paid, status: intent.status });
    }

    if (!tenant.stripe_onboarding_complete) return json({ error: "property Stripe onboarding incomplete" }, 400);
    if (!tenant.deposit_enabled) return json({ error: "this property does not take deposits online" }, 400);
    const { data: resv } = await admin.from("reservations")
      .select("id, confirmation_code, status, source, total_cents, paid_cents, created_at, rooms(name)")
      .eq("id", String(body.reservation_id || "")).eq("tenant_id", tenant.id).maybeSingle();
    if (!resv) return json({ error: "booking not found" }, 404);
    if (resv.status !== "pending" || resv.source !== "direct" || (resv.paid_cents || 0) > 0) {
      return json({ error: "this booking does not need a deposit payment" }, 409);
    }
    if (Date.now() - new Date(resv.created_at).getTime() > REQUEST_TTL_MS) {
      return json({ error: "this booking request has expired; please book again" }, 410);
    }
    const pct = Math.min(100, Math.max(1, Number(tenant.deposit_percent) || 25));
    const amount = Math.round(((resv.total_cents || 0) * pct) / 100);
    if (amount < 50) return json({ error: "deposit amount is too small to charge by card" }, 400);

    // Reuse this booking's open deposit intent (double clicks, page reloads).
    const { data: open } = await admin.from("transactions").select("stripe_payment_intent_id")
      .eq("reservation_id", resv.id).eq("status", "pending").not("stripe_payment_intent_id", "is", null)
      .order("created_at", { ascending: false }).limit(1);
    if (open && open[0]) {
      const existing = await stripe.paymentIntents.retrieve(String(open[0].stripe_payment_intent_id), {}, { stripeAccount });
      if (existing.amount === amount && OPEN_STATUSES.includes(existing.status)) {
        return json({ client_secret: existing.client_secret, payment_intent_id: existing.id, amount_cents: amount });
      }
    }

    const room: any = (resv as any).rooms || {};
    const description = `Booking deposit · ${resv.confirmation_code}${room.name ? " · " + room.name : ""}`;
    const intent = await stripe.paymentIntents.create(
      {
        amount,
        currency: (tenant.currency ?? "usd").toLowerCase(),
        description,
        application_fee_amount: Math.round((amount * APP_FEE_PERCENT) / 100),
        metadata: { tenant_id: tenant.id, reservation_id: resv.id, kind: "deposit" },
      },
      { stripeAccount }
    );

    await admin.from("transactions").insert({
      tenant_id: tenant.id, reservation_id: resv.id,
      description, method: "card", status: "pending",
      amount_cents: amount, stripe_payment_intent_id: intent.id,
    });

    return json({ client_secret: intent.client_secret, payment_intent_id: intent.id, amount_cents: amount });
  } catch (e: any) {
    console.error("charge-guest", e);
    return json({ error: "payment service error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
