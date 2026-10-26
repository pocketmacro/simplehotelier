// SimpleHotelier — start the $30/mo subscription for a property (Stripe Checkout).
// POST { tenant_id, origin } with the user's JWT -> { url }
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (recurring $30/mo price).
// Deploy: supabase functions deploy create-checkout
// deno-lint-ignore-file no-explicit-any
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);

    const { tenant_id, origin } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);
    const price = Deno.env.get("STRIPE_PRICE_ID");
    if (!price) return json({ error: "billing not configured (STRIPE_PRICE_ID)" }, 501);

    // RLS on the user client proves membership; service client writes billing ids.
    const { data: member } = await userClient
      .from("tenant_members").select("tenant_id").eq("tenant_id", tenant_id).eq("user_id", user.id).single();
    if (!member) return json({ error: "not a member of this property" }, 403);

    const { data: tenant } = await admin
      .from("tenants").select("id, name, contact_email, stripe_customer_id").eq("id", tenant_id).single();
    if (!tenant) return json({ error: "property not found" }, 404);

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

    const base = origin || "http://localhost:8000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: base + "/app.html?checkout=success",
      cancel_url: base + "/app.html?checkout=cancelled",
      metadata: { tenant_id: tenant.id },
      // Card is required up front; billing starts after a 30-day free trial.
      payment_method_collection: "always",
      subscription_data: { trial_period_days: 30, metadata: { tenant_id: tenant.id } },
    });
    return json({ url: session.url });
  } catch (e: any) {
    return json({ error: e.message ?? "create-checkout failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
