// SimpleHotelier — Stripe webhook: subscription state + guest card payments.
// Events: checkout.session.completed (subscriptions and guest payment links),
// customer.subscription.updated/deleted, invoice.payment_failed,
// payment_intent.succeeded (deposits, front-desk charges, payment links) and
// charge.refunded (refunds issued in the Stripe Dashboard; record_stripe_refund
// splits each amount into booking money and card fee) and
// setup_intent.succeeded (cards saved to guarantee bookings).
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// deno-lint-ignore-file no-explicit-any
import { createClient, Stripe } from "../_shared/deps.ts";
import { saveCardFromIntent } from "../_shared/cards.ts";
import { logError } from "../_shared/errors.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/* A guest card payment succeeded (deposit, front-desk charge or payment link):
   record it once, keep the card if it was saved, and email a receipt for
   payment links (the dashboard sends its own receipts for card charges). */
async function guestPaymentSucceeded(intent: any) {
  const reservationId = intent.metadata?.reservation_id;
  if (!reservationId) return;
  const fee = Math.max(0, Number(intent.metadata?.fee_cents) || 0); // the guest's card fee isn't booking money
  const { data: recorded, error } = await admin.rpc("record_stripe_payment", {
    p_intent: intent.id,
    p_reservation: reservationId,
    p_amount_cents: (intent.amount_received || intent.amount) - fee,
    p_description: intent.description || null,
    p_kind: intent.metadata?.kind || null,
    p_fee_cents: fee,
  });
  if (error) throw new Error(error.message);
  if (intent.setup_future_usage && intent.customer) await saveCardFromIntent(stripe, admin, reservationId, intent);
  if (recorded && intent.metadata?.kind === "payment_request") {
    await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/send-email", {
      method: "POST",
      headers: { Authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "charge_receipt", reservation_id: reservationId, payment_intent_id: intent.id }),
    }).catch(() => {});
  }
}

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
      if (s.mode === "payment" && s.metadata?.kind === "payment_request" && s.payment_intent) {
        await guestPaymentSucceeded(await stripe.paymentIntents.retrieve(String(s.payment_intent)));
      } else if (tenantId && s.subscription) {
        const sub: any = await stripe.subscriptions.retrieve(String(s.subscription));
        await admin.from("tenants").update({
          stripe_customer_id: String(s.customer),
          stripe_subscription_id: sub.id,
          subscription_status: mapStatus(sub.status),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          subscription_cancel_at: cancelAt(sub),
        }).eq("id", tenantId);
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub: any = event.data.object;
      const patch: any = {
        stripe_subscription_id: sub.id,
        subscription_status: event.type.endsWith("deleted") ? "canceled" : mapStatus(sub.status),
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
        subscription_cancel_at: event.type.endsWith("deleted") ? null : cancelAt(sub),
      };
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) await admin.from("tenants").update(patch).eq("id", tenantId);
      else await admin.from("tenants").update(patch).eq("stripe_customer_id", String(sub.customer));
    } else if (event.type === "payment_intent.succeeded") {
      // Destination charges live on the platform, so these arrive as normal
      // platform events. Idempotent: each intent moves paid_cents once.
      await guestPaymentSucceeded(event.data.object);
    } else if (event.type === "setup_intent.succeeded") {
      const si: any = event.data.object;
      if (si.metadata?.kind === "guarantee" && si.metadata?.reservation_id) {
        await saveCardFromIntent(stripe, admin, si.metadata.reservation_id, si);
      }
    } else if (event.type === "charge.refunded") {
      const charge: any = event.data.object;
      if (charge.payment_intent) {
        const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
        for (const r of refunds.data) {
          if (r.status === "failed" || r.status === "canceled") continue;
          const { error } = await admin.rpc("record_stripe_refund", { p_refund_id: r.id, p_intent: String(charge.payment_intent), p_amount_cents: r.amount });
          if (error) throw new Error(error.message);
        }
      }
    } else if (event.type === "invoice.payment_failed") {
      const inv: any = event.data.object;
      await admin.from("tenants").update({ subscription_status: "past_due" }).eq("stripe_customer_id", String(inv.customer));
    }
  } catch (e: any) {
    console.error("stripe-webhook", event.type, e); await logError(`stripe-webhook (${event.type})`, e);
    return new Response("handler error", { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});

/* When a subscription cancelled in the portal stops (end of the paid month or
   trial), or null while it keeps renewing. */
function cancelAt(sub: any) {
  const at = sub.cancel_at || (sub.cancel_at_period_end ? sub.current_period_end : null);
  return at ? new Date(at * 1000).toISOString() : null;
}

function mapStatus(s: string) {
  return ({ trialing: "trialing", active: "active", past_due: "past_due", canceled: "canceled", unpaid: "unpaid" } as any)[s] || "incomplete";
}
