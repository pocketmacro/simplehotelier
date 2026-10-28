// SimpleHotelier — platform setup via Node (Management API + Stripe API).
// Usage:
//   node scripts/setup-platform.mjs phase1   # migration + admin + Stripe product/price
//   node scripts/setup-platform.mjs phase2   # Stripe webhook + webhook secret
//   node scripts/setup-platform.mjs price    # after changing site.config.json's plan:
//                                            # Stripe price + STRIPE_PRICE_ID secret
// Reads .env; never prints secrets (Stripe key type only, price/product IDs are safe).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { normalize } from "./site.mjs";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const envPath = root + ".env";
// The platform name and plan price (site.config.json).
const SITE = normalize(JSON.parse(readFileSync(root + "site.config.json", "utf8")), root);
function loadEnv() {
  const map = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    map[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return map;
}
function saveEnv(map) {
  const lines = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath, lines.join("\n") + "\n");
}
const env = loadEnv();
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const mgmt = "https://api.supabase.com/v1";
if (!ref || !env.SUPABASE_TOKEN) { console.error("ABORT: .env needs SUPABASE_TOKEN + NEXT_PUBLIC_SUPABASE_URL"); process.exit(1); }

async function sql(query) {
  const res = await fetch(`${mgmt}/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}
async function mgmtSecrets(pairs) {
  const res = await fetch(`${mgmt}/projects/${ref}/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(pairs.map(([name, value]) => ({ name, value })))
  });
  return res.status;
}
const stripeKey = env.STRIPE_API_KEY || "";
async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch("https://api.stripe.com/v1" + path, {
    method, body,
    headers: { Authorization: `Bearer ${stripeKey}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${method} ${path}: ${data?.error?.message || res.status}`);
  return data;
}

async function phase1() {
  // 1) Admin/support migration (chunked) + promote first auth user.
  const mig = readFileSync(root + "supabase/migrations/20261028000000_admin_support.sql", "utf8");
  const chunks = mig.split(/^-- @@CHUNK@@.*$/m).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    await sql(chunks[i]);
    console.log(`admin migration chunk ${i + 1}/${chunks.length}: OK`);
  }
  const users = await sql("select id::text as id, coalesce(email,'(no email)') as email from auth.users order by created_at limit 1;");
  if (users.length) {
    await sql(`insert into public.system_admins (user_id) values ('${users[0].id}') on conflict (user_id) do nothing;`);
    console.log("system admin:", users[0].email);
  }
  const verify = await sql("select (select count(*) from public.system_admins) as admins, (select count(*) from public.support_cases) as cases;");
  console.log("verify:", JSON.stringify(verify));

  // 2) Stripe product + the plan's monthly price (reuse if present).
  if (!stripeKey) { console.log("STRIPE_API_KEY missing: skipping Stripe"); return; }
  await ensurePrice();
}

/* The Stripe product and recurring monthly price for site.config.json's plan
   (reused when they already exist); saves their ids to .env. */
async function ensurePrice() {
  const kind = stripeKey.startsWith("sk_test_") ? "test secret" : stripeKey.startsWith("sk_live_") ? "LIVE secret" : stripeKey.startsWith("rk_") ? "restricted" : "unknown";
  console.log("Stripe key type:", kind);
  const account = await stripe("GET", "/account");
  console.log("Stripe account:", account.id, account.country || "");
  const products = await stripe("GET", "/products?limit=100");
  let product = (products.data || []).find((p) => p.name === SITE.name && p.active);
  if (!product) {
    product = await stripe("POST", "/products", { name: SITE.name, description: `${SITE.name} subscription for cabins and small hotels` });
    console.log("product created:", product.id);
  } else console.log("product reused:", product.id);
  const prices = await stripe("GET", `/prices?product=${product.id}&limit=100`);
  const { priceCents, currency } = SITE.plan;
  let price = (prices.data || []).find((p) => p.active && p.unit_amount === priceCents && p.currency === currency.toLowerCase() && p.recurring?.interval === "month");
  if (!price) {
    price = await stripe("POST", "/prices", { product: product.id, unit_amount: String(priceCents), currency: currency.toLowerCase(), "recurring[interval]": "month" });
    console.log("price created:", price.id, `(${SITE.priceLabel}/month)`);
  } else console.log("price reused:", price.id, `(${SITE.priceLabel}/month)`);
  env.STRIPE_PRODUCT_ID = product.id;
  env.STRIPE_PRICE_ID = price.id;
  saveEnv(env);
  console.log("saved STRIPE_PRODUCT_ID / STRIPE_PRICE_ID to .env");
  return price.id;
}

/* New subscriptions use the plan's price from now on. Existing ones keep the
   price they started with until moved in Stripe (give owners notice first). */
async function priceOnly() {
  if (!stripeKey) { console.error("STRIPE_API_KEY missing"); process.exit(1); }
  const id = await ensurePrice();
  const status = await mgmtSecrets([["STRIPE_PRICE_ID", id]]);
  console.log("STRIPE_PRICE_ID function secret set: HTTP", status);
  if (status >= 300) process.exit(1);
}

async function phase2() {
  if (!stripeKey) { console.log("STRIPE_API_KEY missing"); return; }
  const hookUrl = `https://${ref}.supabase.co/functions/v1/stripe-webhook`;
  const hooks = await stripe("GET", "/webhook_endpoints?limit=100");
  const existing = (hooks.data || []).find((h) => h.url === hookUrl);
  if (existing) {
    console.log("webhook exists:", existing.id, "(secret not retrievable; set STRIPE_WEBHOOK_SECRET from the Stripe Dashboard if checkout events fail)");
    return;
  }
  const events = ["checkout.session.completed", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed"];
  const params = { url: hookUrl, description: `${SITE.name} subscription sync` };
  events.forEach((e, i) => { params[`enabled_events[${i}]`] = e; });
  const hook = await stripe("POST", "/webhook_endpoints", params);
  console.log("webhook created:", hook.id);
  if (hook.secret) {
    const status = await mgmtSecrets([["STRIPE_WEBHOOK_SECRET", hook.secret]]);
    console.log("STRIPE_WEBHOOK_SECRET set via Management API: HTTP", status);
  }
}

const phase = process.argv[2];
if (phase === "phase1") await phase1();
else if (phase === "phase2") await phase2();
else if (phase === "price") await priceOnly();
else { console.error("usage: node scripts/setup-platform.mjs phase1|phase2|price"); process.exit(1); }
console.log("DONE", phase);
