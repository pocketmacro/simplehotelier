// SimpleHotelier — Stripe webhook: keep tenant subscription state in sync.
// Events: checkout.session.completed, customer.subscription.updated/deleted,
// invoice.payment_failed. Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!sig || !secret) return new Response("webhook not configured", { status: 501 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), sig, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s: any = event.data.object;
      const tenantId = s.metadata?.tenant_id;
      if (tenantId && s.subscription) {
        const sub: any = await stripe.subscriptions.retrieve(String(s.subscription));
        await admin.from("tenants").update({
          stripe_customer_id: String(s.customer),
          stripe_subscription_id: sub.id,
          subscription_status: mapStatus(sub.status),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        }).eq("id", tenantId);
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub: any = event.data.object;
      const patch: any = {
        stripe_subscription_id: sub.id,
        subscription_status: event.type.endsWith("deleted") ? "canceled" : mapStatus(sub.status),
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      };
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) await admin.from("tenants").update(patch).eq("id", tenantId);
      else await admin.from("tenants").update(patch).eq("stripe_customer_id", String(sub.customer));
    } else if (event.type === "payment_intent.succeeded") {
      // Guest deposit/charge on a connected account (fires for Connect events
      // when this endpoint is registered as a Connect webhook). Idempotent and
      // atomic: only a still-pending transaction moves paid_cents, once.
      const intent: any = event.data.object;
      const { error } = await admin.rpc("record_stripe_payment", { p_intent: intent.id });
      if (error) throw new Error(error.message);
    } else if (event.type === "invoice.payment_failed") {
      const inv: any = event.data.object;
      await admin.from("tenants").update({ subscription_status: "past_due" }).eq("stripe_customer_id", String(inv.customer));
    }
  } catch (e: any) {
    return new Response("handler error: " + (e.message ?? "unknown"), { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});

function mapStatus(s: string) {
  return ({ trialing: "trialing", active: "active", past_due: "past_due", canceled: "canceled", unpaid: "unpaid" } as any)[s] || "incomplete";
}
