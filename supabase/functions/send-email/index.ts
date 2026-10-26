// SimpleHotelier — transactional guest/owner email (Amazon SES SMTP).
// POST { action: "booking_confirmation", reservation_id }
//   -> emails the guest their confirmation (or request received) and notifies
//      the property. Callable with the anon key right after a public booking:
//      it only ever writes to addresses stored on the reservation/tenant.
// POST { action: "charge_receipt", reservation_id, payment_intent_id? }
//   -> emails the guest a receipt for their latest paid transaction.
// Deploy: supabase functions deploy send-email
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMail, emailShell, kv, p, money, fmtDate, emailConfigured } from "../_shared/email.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const POLICY_TEXT: Record<string, string> = {
  flexible: "Free cancellation up to 7 days before check-in. After that, the first night is non-refundable.",
  moderate: "Free cancellation up to 14 days before check-in. After that, 50% of the stay is non-refundable.",
  strict: "You can cancel your reservation up to 30 days before your stay, but you won't receive a refund if you cancel after that."
};

async function loadReservation(id: string) {
  const { data: r } = await admin.from("reservations").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const [{ data: tenant }, { data: room }] = await Promise.all([
    admin.from("tenants").select("*").eq("id", r.tenant_id).maybeSingle(),
    admin.from("rooms").select("name, code").eq("id", r.room_id).maybeSingle()
  ]);
  return { r, tenant, room };
}

async function bookingConfirmation(reservationId: string) {
  const loaded = await loadReservation(reservationId);
  if (!loaded) return json({ error: "reservation not found" }, 404);
  const { r, tenant, room } = loaded;
  if (!r.guest_email) return json({ sent: false, reason: "guest has no email" });
  if (!emailConfigured()) return json({ sent: false, reason: "email not configured" }, 503);

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
    p(`Hi ${r.guest_name.split(" ")[0] || "there"},`) +
    p(pending
      ? `Thanks for your request to stay at <strong>${property}</strong>. The property will confirm shortly — here are your details in the meantime.`
      : `Your stay at <strong>${property}</strong> is confirmed. We look forward to hosting you.`) +
    kv(rows) +
    (policy ? p(`<strong>Cancellation policy:</strong> ${policy}`) : "") +
    (tenant?.rental_terms ? p(`<strong>Good to know:</strong> ${String(tenant.rental_terms).slice(0, 600)}`) : ""),
    tenant?.contact_phone || tenant?.contact_email
      ? `Questions about your stay? Contact ${property}${tenant?.contact_phone ? ` at ${tenant.contact_phone}` : ""}${tenant?.contact_email ? ` or ${tenant.contact_email}` : ""}.`
      : ""
  );
  const guest = await sendMail({
    to: r.guest_email,
    subject: `${pending ? "Request received" : "Booking confirmed"} · ${r.confirmation_code} · ${property}`,
    html: guestHtml
  });
  await admin.from("reservations").update({ confirmation_email_sent_at: new Date().toISOString() }).eq("id", r.id);

  // Notify the property (best effort).
  const ownerTo = tenant?.booking_email || tenant?.contact_email;
  let ownerSent = false;
  if (ownerTo) {
    const res = await sendMail({
      to: ownerTo,
      subject: `New booking ${r.confirmation_code} · ${r.guest_name} · ${fmtDate(r.check_in)}`,
      html: emailShell("New booking received",
        p(`<strong>${r.guest_name}</strong> just booked through your SimpleHotelier page.`) +
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
      p(`Hi ${r.guest_name.split(" ")[0] || "there"}, thanks — we received your payment for your stay at <strong>${property}</strong>.`) +
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    if (body.action === "booking_confirmation" && body.reservation_id) return await bookingConfirmation(String(body.reservation_id));
    if (body.action === "charge_receipt" && body.reservation_id) return await chargeReceipt(body);
    return json({ error: "action booking_confirmation or charge_receipt with reservation_id required" }, 400);
  } catch (e: any) {
    return json({ error: e.message ?? "send-email failed" }, 500);
  }
});
