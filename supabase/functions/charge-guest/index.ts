// SimpleHotelier — guest card payments on the property's connected Stripe account.
//
// Guest (booking page, anon key):
//   POST { tenant_id, reservation_id }
//     -> { client_secret, payment_intent_id, amount_cents }   booking deposit
//   POST { action: "confirm", tenant_id, payment_intent_id } -> { paid, status }
//   POST { action: "setup", tenant_id, reservation_id } -> { client_secret }
//     no deposit: save the card to guarantee the booking (nothing charged)
//   POST { action: "confirm_setup", tenant_id, setup_intent_id } -> { saved }
// Front desk (dashboard, user JWT; owner/admin/staff):
//   POST { action: "charge_card", tenant_id, reservation_id, amount_cents }
//     charges the card saved on the booking (off-session)
//   POST { action: "payment_request", tenant_id, reservation_id, amount_cents, send_email? }
//     -> { url, emailed }   Stripe-hosted payment link (also saves the card)
//   POST { action: "refund", tenant_id, transaction_id, amount_cents? }   owner/admin
//
// Amounts the browser sends are checked against the reservation's balance;
// the deposit amount is never taken from the browser at all. Payments are
// recorded once by record_stripe_payment(); stripe-webhook is the backup.
// Destination charges: Stripe does not allow direct charges on Express accounts
// for new platforms, so intents live on the platform with
// transfer_data.destination = the property's account and on_behalf_of = that
// account (it is the merchant of record). No platform fee: the property
// receives every cent; SimpleHotelier covers Stripe's processing fee.
// Deploy: supabase functions deploy charge-guest
// deno-lint-ignore-file no-explicit-any
import { createClient, Stripe } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { appOrigin, callerUser, memberRole } from "../_shared/guard.ts";
import { ensureCustomer, saveCardFromIntent } from "../_shared/cards.ts";
import { sendMail, emailShell, kv, p, esc, money, fmtDate, emailConfigured, propertyBrand, button } from "../_shared/email.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const REQUEST_TTL_MS = 24 * 3600e3; // deposit must be paid within a day of the request
const OPEN_STATUSES = ["requires_payment_method", "requires_confirmation", "requires_action"];
const FRONT_DESK = ["owner", "admin", "staff"];
const MIN_CARD_CENTS = 50; // Stripe's minimum charge in USD

const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class Refusal extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/* Status comes from Stripe itself, never the browser; recording is idempotent. */
async function recordIfSucceeded(intent: any, reservationId?: string, kind?: string) {
  if (!intent || intent.status !== "succeeded") return false;
  const { error } = await admin.rpc("record_stripe_payment", {
    p_intent: intent.id,
    p_reservation: reservationId || intent.metadata?.reservation_id || null,
    p_amount_cents: intent.amount_received || intent.amount,
    p_description: intent.description || null,
    p_kind: kind || intent.metadata?.kind || null,
  });
  if (error) throw new Error(error.message);
  return true; // recorded now, or already recorded earlier
}

async function frontDesk(req: Request, tenantId: string, roles = FRONT_DESK) {
  const user = await callerUser(admin, req);
  if (!user) throw new Refusal("Sign in first", 401);
  const role = await memberRole(admin, tenantId, user.id);
  if (!role || !roles.includes(role)) throw new Refusal("Your role cannot take payments for this property", 403);
  return user;
}

async function loadReservation(tenantId: string, reservationId: string) {
  const { data } = await admin.from("reservations")
    .select("*, rooms(name, code)")
    .eq("id", reservationId).eq("tenant_id", tenantId).maybeSingle();
  if (!data) throw new Refusal("booking not found", 404);
  return data;
}

function outstanding(resv: any) {
  return Math.max(0, (resv.total_cents || 0) - (resv.paid_cents || 0));
}

function checkAmount(raw: unknown, max: number) {
  const amount = Math.round(Number(raw));
  if (!Number.isFinite(amount) || amount < MIN_CARD_CENTS) throw new Refusal("Card payments must be at least $0.50");
  if (amount > max) throw new Refusal(`That is more than the ${money(max)} balance due`);
  return amount;
}

/* ---------------------------------------------------------------- deposit */
async function deposit(tenant: any, body: any) {
  if (!tenant.stripe_onboarding_complete) throw new Refusal("property Stripe onboarding incomplete");
  if (!tenant.deposit_enabled) throw new Refusal("this property does not take deposits online");
  const resv = await loadReservation(tenant.id, String(body.reservation_id || ""));
  if (resv.status !== "pending" || resv.source !== "direct" || (resv.paid_cents || 0) > 0) {
    throw new Refusal("this booking does not need a deposit payment", 409);
  }
  if (Date.now() - new Date(resv.created_at).getTime() > REQUEST_TTL_MS) {
    throw new Refusal("this booking request has expired; please book again", 410);
  }
  const pct = Math.min(100, Math.max(1, Number(tenant.deposit_percent) || 25));
  const amount = Math.round(((resv.total_cents || 0) * pct) / 100);
  if (amount < MIN_CARD_CENTS) throw new Refusal("deposit amount is too small to charge by card");

  // Reuse this booking's open deposit intent (double clicks, page reloads).
  const { data: open } = await admin.from("transactions").select("stripe_payment_intent_id")
    .eq("reservation_id", resv.id).eq("status", "pending").not("stripe_payment_intent_id", "is", null)
    .order("created_at", { ascending: false }).limit(1);
  if (open && open[0]) {
    const existing = await stripe.paymentIntents.retrieve(String(open[0].stripe_payment_intent_id));
    if (existing.amount === amount && OPEN_STATUSES.includes(existing.status)) {
      return { client_secret: existing.client_secret, payment_intent_id: existing.id, amount_cents: amount };
    }
  }

  const customer = await ensureCustomer(stripe, admin, resv, tenant.id);
  const description = `Booking deposit · ${resv.confirmation_code}${resv.rooms?.name ? " · " + resv.rooms.name : ""}`;
  const intent = await stripe.paymentIntents.create({
    amount,
    currency: (tenant.currency ?? "usd").toLowerCase(),
    description,
    customer,
    setup_future_usage: "off_session", // the front desk can charge the balance later
    transfer_data: { destination: tenant.stripe_account_id },
    on_behalf_of: tenant.stripe_account_id,
    metadata: { tenant_id: tenant.id, reservation_id: resv.id, kind: "deposit" },
  });
  await admin.from("transactions").insert({
    tenant_id: tenant.id, reservation_id: resv.id, description, method: "card", status: "pending",
    amount_cents: amount, stripe_payment_intent_id: intent.id, kind: "deposit",
  });
  return { client_secret: intent.client_secret, payment_intent_id: intent.id, amount_cents: amount };
}

async function confirm(tenant: any, body: any) {
  if (!body.payment_intent_id) throw new Refusal("payment_intent_id required");
  const intent = await stripe.paymentIntents.retrieve(String(body.payment_intent_id));
  if (intent.metadata?.tenant_id !== tenant.id || intent.transfer_data?.destination !== tenant.stripe_account_id) {
    throw new Refusal("payment does not belong to this property", 403);
  }
  const paid = await recordIfSucceeded(intent);
  if (paid && intent.setup_future_usage) await saveCardFromIntent(stripe, admin, intent.metadata?.reservation_id, intent);
  return { paid, status: intent.status };
}

/* A card is required to book online even without a deposit: save it with a
   SetupIntent (nothing is charged) so the front desk can charge it later. */
async function setup(tenant: any, body: any) {
  if (!tenant.stripe_onboarding_complete) throw new Refusal("property Stripe onboarding incomplete");
  const resv = await loadReservation(tenant.id, String(body.reservation_id || ""));
  if (resv.status !== "pending" || resv.source !== "direct" || !resv.card_required) {
    throw new Refusal("this booking does not need a card", 409);
  }
  if (resv.stripe_payment_method_id) throw new Refusal("a card is already saved for this booking", 409);
  if (Date.now() - new Date(resv.created_at).getTime() > REQUEST_TTL_MS) {
    throw new Refusal("this booking request has expired; please book again", 410);
  }
  const customer = await ensureCustomer(stripe, admin, resv, tenant.id);
  const si = await stripe.setupIntents.create({
    customer,
    usage: "off_session",
    payment_method_types: ["card"], // the booking page shows a card field only
    on_behalf_of: tenant.stripe_account_id,
    description: `Card guarantee · ${resv.confirmation_code}`,
    metadata: { tenant_id: tenant.id, reservation_id: resv.id, kind: "guarantee" },
  });
  return { client_secret: si.client_secret, setup_intent_id: si.id };
}

async function confirmSetup(tenant: any, body: any) {
  if (!body.setup_intent_id) throw new Refusal("setup_intent_id required");
  const si = await stripe.setupIntents.retrieve(String(body.setup_intent_id));
  if (si.metadata?.tenant_id !== tenant.id || !si.metadata?.reservation_id) {
    throw new Refusal("card does not belong to this property", 403);
  }
  if (si.status !== "succeeded") return { saved: false, status: si.status };
  const saved = await saveCardFromIntent(stripe, admin, si.metadata.reservation_id, si);
  return { saved, status: si.status };
}

/* ---------------------------------------------------------------- front desk */
async function chargeCard(req: Request, tenant: any, body: any) {
  const user = await frontDesk(req, tenant.id);
  if (!tenant.stripe_onboarding_complete) throw new Refusal("Finish Stripe setup in Settings before charging cards");
  const resv = await loadReservation(tenant.id, String(body.reservation_id || ""));
  if (!resv.stripe_customer_id || !resv.stripe_payment_method_id) {
    throw new Refusal("No card on file for this booking. Send the guest a payment request instead.", 409);
  }
  const amount = checkAmount(body.amount_cents, outstanding(resv));
  const description = `${resv.confirmation_code} · Card charge${resv.rooms?.name ? " · " + resv.rooms.name : ""}`;
  let intent: any;
  try {
    intent = await stripe.paymentIntents.create({
      amount,
      currency: (tenant.currency ?? "usd").toLowerCase(),
      description,
      customer: resv.stripe_customer_id,
      payment_method: resv.stripe_payment_method_id,
      off_session: true,
      confirm: true,
      transfer_data: { destination: tenant.stripe_account_id },
      on_behalf_of: tenant.stripe_account_id,
      metadata: { tenant_id: tenant.id, reservation_id: resv.id, kind: "charge", by: user.id },
    });
  } catch (e: any) {
    // Declines and "authentication required" come back as card errors with
    // a message written for people; anything else stays generic.
    if (e?.type === "StripeCardError") {
      const needsAuth = e.code === "authentication_required";
      throw new Refusal(needsAuth
        ? "The guest's bank wants them to approve this charge. Send a payment request instead."
        : `Card declined: ${e.message}`, 402);
    }
    throw e;
  }
  const paid = await recordIfSucceeded(intent, resv.id, "charge");
  if (!paid) throw new Refusal(`The charge did not complete (status: ${intent.status}). Try a payment request.`, 402);
  return { paid: true, amount_cents: amount, payment_intent_id: intent.id };
}

async function paymentRequest(req: Request, tenant: any, body: any) {
  await frontDesk(req, tenant.id);
  if (!tenant.stripe_onboarding_complete) throw new Refusal("Finish Stripe setup in Settings before requesting card payments");
  const resv = await loadReservation(tenant.id, String(body.reservation_id || ""));
  const amount = checkAmount(body.amount_cents, outstanding(resv));
  const customer = await ensureCustomer(stripe, admin, resv, tenant.id);
  const site = appOrigin(req.headers.get("origin"));
  const back = `${site}/book.html?property=${encodeURIComponent(tenant.slug)}`;
  const description = `${resv.confirmation_code} · Payment request`;
  const metadata = { tenant_id: tenant.id, reservation_id: resv.id, kind: "payment_request" };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: (tenant.currency ?? "usd").toLowerCase(),
        unit_amount: amount,
        product_data: {
          name: `${tenant.name} · Booking ${resv.confirmation_code}`,
          description: `${fmtDate(resv.check_in)} – ${fmtDate(resv.check_out)}${resv.rooms?.name ? " · " + resv.rooms.name : ""}`,
        },
      },
    }],
    payment_intent_data: {
      description,
      setup_future_usage: "off_session",
      transfer_data: { destination: tenant.stripe_account_id },
      on_behalf_of: tenant.stripe_account_id,
      metadata,
    },
    metadata,
    success_url: `${back}&paid=${encodeURIComponent(resv.confirmation_code)}`,
    cancel_url: back,
  });

  let emailed = false;
  if (body.send_email !== false && resv.guest_email && emailConfigured()) {
    const brand = propertyBrand(tenant);
    const res = await sendMail({
      to: resv.guest_email,
      fromName: brand.name,
      replyTo: brand.replyTo,
      subject: `Payment request · ${resv.confirmation_code} · ${tenant.name}`,
      html: emailShell("Payment request",
        p(`Hi ${esc(String(resv.guest_name || "").trim().split(/\s+/)[0] || "there")},`) +
        p(`<strong>${esc(tenant.name)}</strong> has requested a payment of <strong>${esc(money(amount, tenant.currency))}</strong> for your booking.`) +
        kv([["Confirmation code", resv.confirmation_code], ["Check-in", fmtDate(resv.check_in)], ["Check-out", fmtDate(resv.check_out)], ["Amount", money(amount, tenant.currency)]]) +
        p(button(session.url, `Pay ${money(amount, tenant.currency)} securely`, brand)),
        `Payments are processed securely by Stripe. The link works for 24 hours.${brand.replyTo ? " Questions? Just reply to this email." : ""}`, brand)
    }).catch(() => ({ sent: false }));
    emailed = !!res.sent;
  }
  return { url: session.url, emailed, amount_cents: amount };
}

async function refund(req: Request, tenant: any, body: any) {
  await frontDesk(req, tenant.id, ["owner", "admin"]);
  const { data: txn } = await admin.from("transactions").select("*")
    .eq("id", String(body.transaction_id || "")).eq("tenant_id", tenant.id).maybeSingle();
  if (!txn || !txn.stripe_payment_intent_id || txn.amount_cents <= 0 || !["paid", "refunded"].includes(txn.status)) {
    throw new Refusal("Only card payments can be refunded here", 409);
  }
  const { data: done } = await admin.from("transactions").select("amount_cents").eq("parent_id", txn.id).eq("kind", "refund");
  const refundable = txn.amount_cents + (done || []).reduce((s: number, r: any) => s + (r.amount_cents || 0), 0);
  if (refundable <= 0) throw new Refusal("This payment has already been refunded", 409);
  const amount = body.amount_cents == null ? refundable : Math.round(Number(body.amount_cents));
  if (!Number.isFinite(amount) || amount < 1 || amount > refundable) throw new Refusal(`Refund between $0.01 and ${money(refundable)}`);
  const r = await stripe.refunds.create({
    payment_intent: txn.stripe_payment_intent_id,
    amount,
    reverse_transfer: true, // pull the money back from the property's Stripe balance
    metadata: { tenant_id: tenant.id, reservation_id: txn.reservation_id || "" },
  });
  const { error } = await admin.rpc("record_stripe_refund", { p_refund_id: r.id, p_intent: txn.stripe_payment_intent_id, p_amount_cents: amount });
  if (error) throw new Error(error.message);
  return { refunded: true, amount_cents: amount, status: r.status };
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenant_id || "");
    if (!tenantId) return json({ error: "tenant_id required" }, 400);
    const { data: tenant } = await admin.from("tenants")
      .select("id, name, slug, currency, stripe_account_id, stripe_onboarding_complete, deposit_enabled, deposit_percent, logo_url, booking_theme, contact_email, booking_email, enquiry_email, contact_phone, phone, address_line1, city, state, postcode, website_url")
      .eq("id", tenantId).maybeSingle();
    if (!tenant?.stripe_account_id) return json({ error: "property has not connected Stripe" }, 400);

    switch (body.action) {
      case "confirm": return json(await confirm(tenant, body));
      case "setup": return json(await setup(tenant, body));
      case "confirm_setup": return json(await confirmSetup(tenant, body));
      case "charge_card": return json(await chargeCard(req, tenant, body));
      case "payment_request": return json(await paymentRequest(req, tenant, body));
      case "refund": return json(await refund(req, tenant, body));
      default: return json(await deposit(tenant, body));
    }
  } catch (e: any) {
    if (e instanceof Refusal) return json({ error: e.message }, e.status);
    console.error("charge-guest", e);
    return json({ error: "payment service error" }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
