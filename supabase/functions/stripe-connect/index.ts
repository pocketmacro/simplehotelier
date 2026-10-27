// SimpleHotelier — create/reuse a Stripe Connect account for a property.
// POST { tenant_id }  ->  { account_id, onboarding_url }
// Deploy: supabase functions deploy stripe-connect
// Secrets: STRIPE_SECRET_KEY (test key until launch)
// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { tenant_id, action } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const { data: tenant, error } = await admin
      .from("tenants").select("id, name, contact_email, stripe_account_id").eq("id", tenant_id).single();
    if (error || !tenant) return json({ error: "tenant not found" }, 404);

    /* Status sync: Stripe is the source of truth for onboarding completion.
       The dashboard calls this after Connect onboarding and on load so the
       Settings checklist / Connect button reflect reality. */
    if (action === "status") {
      if (!tenant.stripe_account_id) return json({ connected: false, has_account: false });
      const account = await stripe.accounts.retrieve(tenant.stripe_account_id as string);
      const connected = !!(account.charges_enabled && account.details_submitted);
      await admin.from("tenants")
        .update({ stripe_onboarding_complete: connected })
        .eq("id", tenant.id);
      return json({
        connected, has_account: true,
        charges_enabled: !!account.charges_enabled,
        details_submitted: !!account.details_submitted,
        payouts_enabled: !!account.payouts_enabled
      });
    }

    let accountId = tenant.stripe_account_id as string | null;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: tenant.contact_email ?? undefined,
        business_profile: { name: tenant.name },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { tenant_id: tenant.id },
      });
      accountId = account.id;
      await admin.from("tenants").update({ stripe_account_id: accountId }).eq("id", tenant.id);
    }

    const origin = req.headers.get("origin") ?? "http://localhost:8000";
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: origin + "/app.html?stripe=refresh",
      return_url: origin + "/app.html?stripe=done",
    });
    return json({ account_id: accountId, onboarding_url: link.url });
  } catch (e: any) {
    return json({ error: e.message ?? "stripe-connect failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
