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
// Deploy: supabase functions deploy send-email
// deno-lint-ignore-file no-explicit-any
import { createClient } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { sendMail, emailShell, kv, p, esc, money, fmtDate, emailConfigured } from "../_shared/email.ts";
import { appOrigin, callerUser, memberRole } from "../_shared/guard.ts";

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
  const balance = (r.total_cents || 0) - (r.paid_cents || 0);
  const policy = tenant?.cancellation_policy === "custom"
    ? (tenant?.cancellation_policy_text || "")
    : (POLICY_TEXT[tenant?.cancellation_policy || "moderate"] || "");
  const rows: [string, string][] = [
    ["Confirmation code", r.confirmation_code],
    ["Property", property],
    ["Room", room ? `${room.code} · ${room.name}` : ""],
    ["Check-in", fmtDate(r.check_in)],
    ["Check-out", fmtDate(r.check_out)],
    ["Guests", String(r.adults || 1)],
    ["Total", money(r.total_cents, tenant?.currency)],
    ...(balance > 0 ? [["Balance due at property", money(balance, tenant?.currency)] as [string, string]] : [["Payment", "Paid in full"] as [string, string]])
  ];
  const guestHtml = emailShell(
    pending ? "Booking request received" : "Booking confirmed",
    p(`Hi ${esc(firstName(r.guest_name))},`) +
    p(pending
      ? `Thanks for your request to stay at <strong>${esc(property)}</strong>. The property will confirm shortly — here are your details in the meantime.`
      : `Your stay at <strong>${esc(property)}</strong> is confirmed. We look forward to hosting you.`) +
    kv(rows) +
    (policy ? p(`<strong>Cancellation policy:</strong> ${esc(policy)}`) : "") +
    (tenant?.rental_terms ? p(`<strong>Good to know:</strong> ${esc(String(tenant.rental_terms).slice(0, 600))}`) : ""),
    tenant?.contact_phone || tenant?.contact_email
      ? `Questions about your stay? Contact ${esc(property)}${tenant?.contact_phone ? ` at ${esc(tenant.contact_phone)}` : ""}${tenant?.contact_email ? ` or ${esc(tenant.contact_email)}` : ""}.`
      : ""
  );
  const guest = await sendMail({
    to: r.guest_email,
    subject: `${pending ? "Request received" : "Booking confirmed"} · ${r.confirmation_code} · ${property}`,
    html: guestHtml
  });

  // Notify the property (best effort).
  const ownerTo = tenant?.booking_email || tenant?.contact_email;
  let ownerSent = false;
  if (ownerTo) {
    const res = await sendMail({
      to: ownerTo,
      subject: `New booking ${r.confirmation_code} · ${r.guest_name} · ${fmtDate(r.check_in)}`,
      html: emailShell("New booking received",
        p(`<strong>${esc(r.guest_name)}</strong> just booked through your SimpleHotelier page.`) +
        kv([...rows, ["Guest email", r.guest_email], ...(r.guest_phone ? [["Guest phone", r.guest_phone] as [string, string]] : [])]))
    }).catch(() => ({ sent: false }));
    ownerSent = !!res.sent;
  }
  return json({ sent: guest.sent, ownerNotified: ownerSent });
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
  const res = await sendMail({
    to: r.guest_email,
    subject: `Payment receipt · ${r.confirmation_code} · ${property}`,
    html: emailShell("Payment received",
      p(`Hi ${esc(firstName(r.guest_name))}, thanks — we received your payment for your stay at <strong>${esc(property)}</strong>.`) +
      kv([
        ["Confirmation code", r.confirmation_code],
        ["Description", txn.description || "Card charge"],
        ["Amount paid", money(txn.amount_cents, tenant?.currency)],
        ["Date", new Date(txn.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })],
        ...(balance > 0 ? [["Remaining balance", money(balance, tenant?.currency)] as [string, string]] : [["Balance", "Paid in full"] as [string, string]])
      ]))
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
    subject: `You're invited to join ${tenant.name} on SimpleHotelier`,
    html: emailShell(`Join ${tenant.name}`,
      p(`Hi,`) +
      p(`You've been invited to join <strong>${esc(tenant.name)}</strong> on SimpleHotelier as ${roleLabel}. Create your free account with this email address and you'll be taken straight into the property — no card or trial needed.`) +
      p(`<a href="${esc(link)}" style="display:inline-block;background:#0c3b3c;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px">Accept invite &amp; create account</a>`) +
      p(`Or paste this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span>`),
      `This invite was sent to ${esc(email)}. If it wasn't meant for you, you can ignore this email.`)
  });
  return json({ sent: res.sent, email, role });
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    if (body.action === "booking_confirmation" && body.reservation_id) {
      if (!body.force) return await bookingConfirmation(String(body.reservation_id));
      const user = await callerUser(admin, req);
      const { data: resv } = await admin.from("reservations").select("tenant_id").eq("id", String(body.reservation_id)).maybeSingle();
      const role = user && resv ? await memberRole(admin, resv.tenant_id, user.id) : null;
      if (!role || !["owner", "admin", "staff"].includes(role)) return json({ error: "Only the front desk team can resend confirmations" }, 403);
      return await bookingConfirmation(String(body.reservation_id), true);
    }
    if (body.action === "charge_receipt" && body.reservation_id) return await chargeReceipt(body);
    if (body.action === "team_invite") return await teamInvite(req, body);
    return json({ error: "action booking_confirmation, charge_receipt or team_invite required" }, 400);
  } catch (e: any) {
    console.error("send-email", e);
    return json({ error: "send-email failed" }, 500);
  }
}));
