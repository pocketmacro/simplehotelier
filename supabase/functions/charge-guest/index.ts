// SimpleHotelier — charge a guest on the property's connected Stripe account.
// POST { tenant_id, reservation_id, amount_cents, description? }
//   -> { client_secret, payment_intent_id }
// The browser confirms the PaymentIntent with Stripe.js (publishable key).
// A webhook (next step) marks folio/transactions paid — never trust the browser alone.
// Deploy: supabase functions deploy charge-guest
// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_FEE_PERCENT = 1.0; // SimpleHotelier platform fee — tune per plan.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* Verify a deposit PaymentIntent server-side and mark it paid (idempotent).
   The browser's word is never trusted: status comes from Stripe itself. */
async function markDepositPaid(tenant: any, intent: any) {
  if (!intent || intent.status !== "succeeded") return false;
  const reservationId = intent.metadata?.reservation_id;
  const { data: txn } = await admin.from("transactions")
    .select("id, status, amount_cents").eq("stripe_payment_intent_id", intent.id).maybeSingle();
  if (!txn || txn.status === "paid") return true; // already recorded: do not double-count
  await admin.from("transactions").update({ status: "paid" }).eq("id", txn.id);
  if (reservationId) {
    const { data: resv } = await admin.from("reservations").select("paid_cents").eq("id", reservationId).single();
    if (resv) await admin.from("reservations").update({ paid_cents: (resv.paid_cents || 0) + (txn.amount_cents || intent.amount) }).eq("id", reservationId);
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const { tenant_id, reservation_id, amount_cents, description } = body;
    if (body.action === "confirm") {
      if (!tenant_id || !body.payment_intent_id) return json({ error: "tenant_id and payment_intent_id required" }, 400);
      const { data: tenant } = await admin.from("tenants").select("stripe_account_id").eq("id", tenant_id).single();
      if (!tenant?.stripe_account_id) return json({ error: "property has not connected Stripe" }, 400);
      const intent = await stripe.paymentIntents.retrieve(String(body.payment_intent_id), {}, { stripeAccount: tenant.stripe_account_id });
      const paid = await markDepositPaid(tenant, intent);
      return json({ paid, status: intent.status });
    }
    if (!tenant_id || !reservation_id || !amount_cents) {
      return json({ error: "tenant_id, reservation_id, amount_cents required" }, 400);
    }

    const { data: tenant, error } = await admin
      .from("tenants").select("stripe_account_id, stripe_onboarding_complete, currency")
      .eq("id", tenant_id).single();
    if (error || !tenant?.stripe_account_id) return json({ error: "property has not connected Stripe" }, 400);
    if (!tenant.stripe_onboarding_complete) return json({ error: "property Stripe onboarding incomplete" }, 400);

    const fee = Math.round((amount_cents * APP_FEE_PERCENT) / 100);
    const intent = await stripe.paymentIntents.create(
      {
        amount: amount_cents,
        currency: (tenant.currency ?? "usd").toLowerCase(),
        description: description ?? "SimpleHotelier charge",
        application_fee_amount: fee,
        metadata: { tenant_id, reservation_id },
      },
      { stripeAccount: tenant.stripe_account_id }
    );

    await admin.from("transactions").insert({
      tenant_id, reservation_id,
      description: description ?? "Card charge",
      method: "card", status: "pending",
      amount_cents, stripe_payment_intent_id: intent.id,
    });

    return json({ client_secret: intent.client_secret, payment_intent_id: intent.id });
  } catch (e: any) {
    return json({ error: e.message ?? "charge-guest failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
