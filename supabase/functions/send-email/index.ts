// SimpleHotelier — transactional guest/owner email (Amazon SES SMTP).
// POST { action: "booking_confirmation", reservation_id }
//   -> emails the guest their confirmation (or request received) and notifies
//      the property. Callable with the anon key right after a public booking:
//      it only ever writes to addresses stored on the reservation/tenant, and
//      only once per reservation (confirmation_email_sent_at is claimed first).
//      With force: true and a front-desk user's JWT, it is sent again (the
//      dashboard's "Email confirmation" button).
// POST { action: "charge_receipt", reservation_id, payment_intent_id? }
//   -> emails the guest a receipt for their latest paid transaction.
// POST { action: "booking_update", reservation_id, change: "cancelled" | "changed" }
//   -> tells the guest their booking was cancelled, or shows the new details
//      after a date or room change. Front-desk users only (their JWT).
// Deploy: supabase functions deploy send-email
// deno-lint-ignore-file no-explicit-any
import { createClient } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { sendMail, emailShell, kv, p, esc, money, fmtDate, emailConfigured, propertyBrand } from "../_shared/email.ts";
import { appOrigin, callerUser, memberRole } from "../_shared/guard.ts";
import { logError } from "../_shared/errors.ts";
import { SITE } from "../_shared/site.js";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Preset wording must match what owners pick in Settings and guests read on
// the booking page (js/book.js cancellationText); custom policies are used
// word-for-word. tests/policy-text.test.mjs keeps the three in sync.
const POLICY_TEXT: Record<string, string> = {
  flexible: "Flexible cancellation: full refund if you cancel at least 48 hours before check-in.",
  moderate: "Moderate cancellation: full refund if you cancel at least 7 days before check-in.",
  strict: "Strict cancellation: 50% refund if you cancel at least 14 days before check-in."
};

const firstName = (name: unknown) => String(name || "").trim().split(/\s+/)[0] || "there";

async function loadReservation(id: string) {
  const { data: r } = await admin.from("reservations").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [{ data: tenant }, { data: room }] = await Promise.all([
    admin.from("tenants").select("*").eq("id", r.tenant_id).maybeSingle(),
    admin.from("rooms").select("name, code").eq("id", r.room_id).maybeSingle()
  ]);
  return { r, tenant, room };
}

async function bookingConfirmation(reservationId: string, force = false) {
  const loaded = await loadReservation(reservationId);
  if (!loaded) return json({ error: "reservation not found" }, 404);
  const { r, tenant, room } = loaded;
  if (!r.guest_email) return json({ sent: false, reason: "guest has no email" });
  if (!emailConfigured()) return json({ sent: false, reason: "email not configured" }, 503);
  // One confirmation per reservation: claim the flag atomically so repeated
  // or concurrent calls (anyone holding the id) cannot resend. Staff resends
  // (force, checked by the caller) skip the claim.
  if (force) {
    await admin.from("reservations").update({ confirmation_email_sent_at: new Date().toISOString() }).eq("id", r.id);
  } else {
    const { data: claimed } = await admin.from("reservations")
      .update({ confirmation_email_sent_at: new Date().toISOString() })
      .eq("id", r.id).is("confirmation_email_sent_at", null).select("id");
    if (!claimed || !claimed.length) return json({ sent: false, reason: "already sent" });
  }

  const pending = r.status === "pending";
  const property = tenant?.name || "Your property";
  const policy = policyText(tenant);
  const rows = stayRows(r, tenant, room);
  // Guests see the property (its brand, its contact details) and reply to it.
  const brand = propertyBrand(tenant);
  const guestHtml = emailShell(
    pending ? "Booking request received" : "Booking confirmed",
    p(`Hi ${esc(firstName(r.guest_name))},`) +
    p(pending
      ? `Thanks for your request to stay at <strong>${esc(property)}</strong>. The property will confirm shortly — here are your details in the meantime.`
      : `Your stay at <strong>${esc(property)}</strong> is confirmed. We look forward to hosting you.`) +
    kv(rows) +
    (policy ? p(`<strong>Cancellation policy:</strong> ${esc(policy)}`) : "") +
    (tenant?.rental_terms ? p(`<strong>Good to know:</strong> ${esc(String(tenant.rental_terms).slice(0, 600))}`) : ""),
    guestFooter(brand, property),
    brand
  );
  const guest = await sendMail({
    to: r.guest_email,
    subject: `${pending ? "Request received" : "Booking confirmed"} · ${r.confirmation_code} · ${property}`,
    html: guestHtml,
    fromName: brand.name,
    replyTo: brand.replyTo
  });

  // Notify the property (best effort).
  const ownerTo = tenant?.booking_email || tenant?.contact_email;
  let ownerSent = false;
  if (ownerTo) {
    const res = await sendMail({
      to: ownerTo,
      subject: `New booking ${r.confirmation_code} · ${r.guest_name} · ${fmtDate(r.check_in)}`,
      html: emailShell("New booking received",
        p(`<strong>${esc(r.guest_name)}</strong> just booked through your booking page. Reply to this email to write to them.`) +
        kv([...rows, ["Guest email", r.guest_email], ...(r.guest_phone ? [["Guest phone", r.guest_phone] as [string, string]] : [])])),
      replyTo: r.guest_email
    }).catch(() => ({ sent: false }));
    ownerSent = !!res.sent;
  }
  return json({ sent: guest.sent, ownerNotified: ownerSent });
}

function policyText(tenant: any) {
  return tenant?.cancellation_policy === "custom"
    ? (tenant?.cancellation_policy_text || "")
    : (POLICY_TEXT[tenant?.cancellation_policy || "moderate"] || "");
}

// The stay as the guest sees it: dates, room, party and money.
function stayRows(r: any, tenant: any, room: any): [string, string][] {
  const property = tenant?.name || "Your property";
  const balance = (r.total_cents || 0) - (r.paid_cents || 0);
  return [
    ["Confirmation code", r.confirmation_code],
    ["Property", property],
    ["Room", room ? `${room.code} · ${room.name}` : ""],
    ["Check-in", fmtDate(r.check_in)],
    ["Check-out", fmtDate(r.check_out)],
    ["Guests", [`${r.adults || 1} adult${(r.adults || 1) === 1 ? "" : "s"}`,
      r.children ? `${r.children} ${r.children === 1 ? "child" : "children"}` : "",
      r.infants ? `${r.infants} infant${r.infants === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ")],
    ...(r.arrival_time ? [["Estimated arrival", String(r.arrival_time)] as [string, string]] : []),
    ["Total", money(r.total_cents, tenant?.currency)],
    ...(balance > 0 ? [["Balance due at property", money(balance, tenant?.currency)] as [string, string]] : [["Payment", "Paid in full"] as [string, string]])
  ];
}

function guestFooter(brand: any, property: string) {
  return brand.replyTo || brand.phone
    ? `Questions about your stay? ${brand.replyTo ? "Just reply to this email" : `Call ${esc(property)}`}${brand.phone ? `${brand.replyTo ? " or call" : " at"} ${esc(brand.phone)}` : ""}.`
    : "";
}

/* The front desk cancelled the booking, or moved its dates or room: tell the
   guest, from the property, with the booking as it now stands. */
async function bookingUpdate(reservationId: string, change: string) {
  const loaded = await loadReservation(reservationId);
  if (!loaded) return json({ error: "reservation not found" }, 404);
  const { r, tenant, room } = loaded;
  if (!r.guest_email) return json({ sent: false, reason: "guest has no email" });
  if (!emailConfigured()) return json({ sent: false, reason: "email not configured" }, 503);
  // Only news that matches the booking as saved: no "cancelled" email for a
  // live booking, no "new details" for a cancelled one.
  if ((change === "cancelled") !== (r.status === "cancelled")) return json({ sent: false, reason: "booking status doesn't match" }, 409);

  const property = tenant?.name || "Your property";
  const brand = propertyBrand(tenant);
  const cancelled = change === "cancelled";
  const paid = r.paid_cents || 0;
  const policy = policyText(tenant);
  const body = cancelled
    ? p(`Hi ${esc(firstName(r.guest_name))},`) +
      p(`Your booking at <strong>${esc(property)}</strong> has been cancelled.`) +
      kv([
        ["Confirmation code", r.confirmation_code],
        ["Room", room ? `${room.code} · ${room.name}` : ""],
        ["Check-in", fmtDate(r.check_in)],
        ["Check-out", fmtDate(r.check_out)],
        ...(paid > 0 ? [["Paid so far", money(paid, tenant?.currency)] as [string, string]] : [])
      ]) +
      (paid > 0 ? p(`Any refund follows the property's cancellation policy${policy ? `: ${esc(policy)}` : "."} Refunds to a card usually take 5–10 business days to appear.`) : "") +
      p(`If you didn't expect this, please contact ${esc(property)} right away.`)
    : p(`Hi ${esc(firstName(r.guest_name))},`) +
      p(`<strong>${esc(property)}</strong> has updated your booking. Here are the details as they stand now. Please check the dates, and get in touch if anything looks wrong.`) +
      kv(stayRows(r, tenant, room));
  const res = await sendMail({
    to: r.guest_email,
    subject: `${cancelled ? "Booking cancelled" : "Booking updated"} · ${r.confirmation_code} · ${property}`,
    html: emailShell(cancelled ? "Booking cancelled" : "Your booking has changed", body, guestFooter(brand, property), brand),
    fromName: brand.name,
    replyTo: brand.replyTo
  });
  return json({ sent: res.sent });
}

async function chargeReceipt(body: any) {
  const loaded = await loadReservation(String(body.reservation_id || ""));
  if (!loaded) return json({ error: "reservation not found" }, 404);
  const { r, tenant } = loaded;
  if (!r.guest_email) return json({ sent: false, reason: "guest has no email" });
  if (!emailConfigured()) return json({ sent: false, reason: "email not configured" }, 503);

  let q = admin.from("transactions").select("*").eq("reservation_id", r.id).eq("status", "paid").order("created_at", { ascending: false }).limit(1);
  if (body.payment_intent_id) q = q.eq("stripe_payment_intent_id", String(body.payment_intent_id));
  const { data: txns } = await q;
  const txn = txns && txns[0];
  if (!txn) return json({ sent: false, reason: "no paid transaction found" });

  const balance = (r.total_cents || 0) - (r.paid_cents || 0);
  const property = tenant?.name || "Your property";
  const brand = propertyBrand(tenant);
  const res = await sendMail({
    to: r.guest_email,
    subject: `Payment receipt · ${r.confirmation_code} · ${property}`,
    fromName: brand.name,
    replyTo: brand.replyTo,
    html: emailShell("Payment received",
      p(`Hi ${esc(firstName(r.guest_name))}, thanks — we received your payment for your stay at <strong>${esc(property)}</strong>.`) +
      kv([
        ["Confirmation code", r.confirmation_code],
        ["Description", txn.description || "Card charge"],
        ...(txn.fee_cents > 0
          ? [["Toward your booking", money(txn.amount_cents, tenant?.currency)], ["Card processing fee", money(txn.fee_cents, tenant?.currency)],
            ["Amount paid", money(txn.amount_cents + txn.fee_cents, tenant?.currency)]] as [string, string][]
          : [["Amount paid", money(txn.amount_cents, tenant?.currency)]] as [string, string][]),
        ["Date", new Date(txn.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })],
        ...(balance > 0 ? [["Remaining balance", money(balance, tenant?.currency)] as [string, string]] : [["Balance", "Paid in full"] as [string, string]])
      ]), brand.replyTo ? "Questions? Just reply to this email." : "", brand)
  });
  return json({ sent: res.sent });
}

/* Team invite: a property owner/admin stores an invite and we email it.
   The invitee creates a free account (no property, no card) and is joined to
   the property by accept-invite, matched on token + account email.
   Owners may invite admins; admins may invite staff and cleaners. */
async function teamInvite(req: Request, body: any) {
  const user = await callerUser(admin, req);
  if (!user) return json({ error: "Sign in first" }, 401);
  const tenantId = String(body.tenant_id || "");
  const email = String(body.email || "").trim().toLowerCase();
  const role = ["admin", "staff", "cleaner", "maintenance"].includes(body.role) ? body.role : "cleaner";
  if (!tenantId || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "tenant_id and a valid email are required" }, 400);
  const myRole = await memberRole(admin, tenantId, user.id);
  if (myRole !== "owner" && myRole !== "admin") return json({ error: "Only the property owner or an admin can send invites" }, 403);
  if (role === "admin" && myRole !== "owner") return json({ error: "Only the property owner can invite admins" }, 403);
  // Already on this property: there's nothing to join (change their role instead).
  const { data: found } = await admin.rpc("auth_user_by_email", { p_email: email });
  const existing = Array.isArray(found) ? found[0] : null;
  if (existing && await memberRole(admin, tenantId, existing.id)) {
    return json({ error: `${email} is already on your team. Change their role under Settings → Team & invites.`, already_member: true }, 409);
  }
  const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
  if (!tenant) return json({ error: "property not found" }, 404);
  if (!emailConfigured()) return json({ sent: false, reason: "email not configured" }, 503);

  // One live invite per person per property: replace any pending one.
  await admin.from("invites").delete().eq("tenant_id", tenantId).eq("email", email).is("accepted_at", null);
  const { data: invite, error } = await admin.from("invites")
    .insert({ tenant_id: tenantId, email, role, invited_by: user.id })
    .select("token").single();
  if (error || !invite) return json({ error: "could not store the invite" }, 500);

  const link = `${appOrigin(req.headers.get("origin"))}/app.html?invite=${encodeURIComponent(invite.token)}`;
  const roleLabel = ({ cleaner: "housekeeping", staff: "front desk", maintenance: "maintenance", admin: "an admin" } as Record<string, string>)[role] || role;
  const res = await sendMail({
    to: email,
    subject: `You're invited to join ${tenant.name} on ${SITE.name}`,
    html: emailShell(`Join ${tenant.name}`,
      p(`Hi,`) +
      p(`You've been invited to join <strong>${esc(tenant.name)}</strong> on ${esc(SITE.name)} as ${roleLabel}. New to ${esc(SITE.name)}? Set a password and you're straight in, with no card or trial needed. Already have an account with this email? Log in and ${esc(tenant.name)} is added to it.`) +
      p(`<a href="${esc(link)}" style="display:inline-block;background:#0c3b3c;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px">Accept invite</a>`) +
      p(`Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span>`),
      `This invite was sent to ${esc(email)}. If it wasn't meant for you, you can ignore this email.`)
  });
  return json({ sent: res.sent, email, role });
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // A malformed body is the caller's mistake (400 below), not a server error.
    const body = await req.json().catch(() => ({}));
    if (body.action === "booking_confirmation" && body.reservation_id) {
      if (!body.force) return await bookingConfirmation(String(body.reservation_id));
      const user = await callerUser(admin, req);
      const { data: resv } = await admin.from("reservations").select("tenant_id").eq("id", String(body.reservation_id)).maybeSingle();
      const role = user && resv ? await memberRole(admin, resv.tenant_id, user.id) : null;
      if (!role || !["owner", "admin", "staff"].includes(role)) return json({ error: "Only the front desk team can resend confirmations" }, 403);
      return await bookingConfirmation(String(body.reservation_id), true);
    }
    if (body.action === "charge_receipt" && body.reservation_id) return await chargeReceipt(body);
    if (body.action === "booking_update" && body.reservation_id && ["cancelled", "changed"].includes(body.change)) {
      const user = await callerUser(admin, req);
      const { data: resv } = await admin.from("reservations").select("tenant_id").eq("id", String(body.reservation_id)).maybeSingle();
      const role = user && resv ? await memberRole(admin, resv.tenant_id, user.id) : null;
      if (!role || !["owner", "admin", "staff"].includes(role)) return json({ error: "Only the front desk team can email guests about their booking" }, 403);
      return await bookingUpdate(String(body.reservation_id), body.change);
    }
    if (body.action === "team_invite") return await teamInvite(req, body);
    return json({ error: "action booking_confirmation, charge_receipt, booking_update or team_invite required" }, 400);
  } catch (e: any) {
    console.error("send-email", e); await logError("send-email", e);
    return json({ error: "send-email failed" }, 500);
  }
}));
