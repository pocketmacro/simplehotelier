// SimpleHotelier — the property's platform subscription (plan in site.config.json).
// POST { tenant_id, origin } with the user's JWT -> { url } (Stripe Checkout)
// POST { action: "portal", tenant_id, origin } -> { url } (Stripe Customer
//   Portal: change card, download invoices, cancel at the end of the period)
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (the recurring monthly price;
// scripts/setup-platform.mjs creates it from the config's plan).
// Deploy: supabase functions deploy create-checkout
// deno-lint-ignore-file no-explicit-any
import { createClient, Stripe } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { appOrigin } from "../_shared/guard.ts";
import { logError } from "../_shared/errors.ts";
import { SITE } from "../_shared/site.js";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE_URL = (Deno.env.get("SITE_URL") || SITE.siteUrl).replace(/\/$/, "");

const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A subscription in one of these states is still billing: never start a second.
const LIVE_STATUSES = ["trialing", "active", "past_due", "unpaid"];

/* The portal needs a saved configuration in each Stripe mode (test, live).
   Ours is created on first use, tagged with a version, so going live needs
   no dashboard step. Bump PORTAL_VERSION to roll out changed settings. */
const PORTAL_VERSION = "1";
let portalConfig: string | null = null;
async function portalConfiguration() {
  if (portalConfig) return portalConfig;
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const found = list.data.find((c: any) => c.metadata?.simplehotelier === PORTAL_VERSION);
  if (found) return (portalConfig = found.id);
  const made = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: `${SITE.name} · ${SITE.priceLabel}/month, everything included`,
      privacy_policy_url: SITE_URL + "/privacy",
      terms_of_service_url: SITE_URL + "/terms",
    },
    default_return_url: SITE_URL + "/app#settings",
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end", // keeps working until the paid month (or trial) runs out
        proration_behavior: "none",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
      },
    },
    metadata: { simplehotelier: PORTAL_VERSION },
  });
  return (portalConfig = made.id);
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);

    const { tenant_id, origin, action } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    // RLS on the user client proves membership; service client writes billing ids.
    const { data: member } = await userClient
      .from("tenant_members").select("role").eq("tenant_id", tenant_id).eq("user_id", user.id).single();
    if (!member) return json({ error: "not a member of this property" }, 403);
    if (member.role !== "owner" && member.role !== "admin") return json({ error: "Only the property owner or an admin can manage billing" }, 403);

    const { data: tenant } = await admin
      .from("tenants").select("id, name, contact_email, stripe_customer_id, stripe_subscription_id, subscription_status")
      .eq("id", tenant_id).single();
    if (!tenant) return json({ error: "property not found" }, 404);
    const base = appOrigin(origin || req.headers.get("origin"));
    const hasLiveSub = !!tenant.stripe_subscription_id && LIVE_STATUSES.includes(tenant.subscription_status);

    if (action === "portal") {
      if (!tenant.stripe_customer_id) return json({ error: "Start your subscription first" }, 409);
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        configuration: await portalConfiguration(),
        return_url: base + "/app.html?billing=updated#settings",
      });
      return json({ url: session.url });
    }

    const price = Deno.env.get("STRIPE_PRICE_ID");
    if (!price) return json({ error: "billing not configured (STRIPE_PRICE_ID)" }, 501);
    // Already subscribed: send them to the portal instead of a second subscription.
    if (hasLiveSub) return json({ error: "This property already has a subscription", portal: true }, 409);

    let customerId = tenant.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: tenant.contact_email || user.email,
        name: tenant.name,
        metadata: { tenant_id: tenant.id },
      });
      customerId = customer.id;
      await admin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", tenant.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: base + "/app.html?checkout=success",
      cancel_url: base + "/app.html?checkout=cancelled",
      metadata: { tenant_id: tenant.id },
      // Card is required up front. The free trial is for a property's
      // first subscription only, not for each re-subscribe after cancelling.
      payment_method_collection: "always",
      subscription_data: {
        ...(tenant.stripe_subscription_id ? {} : { trial_period_days: SITE.plan.trialDays }),
        metadata: { tenant_id: tenant.id },
      },
    });
    return json({ url: session.url, trial: !tenant.stripe_subscription_id });
  } catch (e: any) {
    console.error("create-checkout", e); await logError("create-checkout", e);
    return json({ error: "create-checkout failed" }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
