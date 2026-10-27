// SimpleHotelier — daily jobs, invoked by pg_cron (see migration
// 20261108000000) or any scheduler with the x-cron-secret header:
//   1. Check-in reminders for tomorrow's arrivals (once per reservation)
//   2. Check-out reminders for tomorrow's departures (once per reservation)
//   3. Sync every Airbnb/Vrbo iCal feed into blocked dates
//   4. Monday weekly owner report (occupancy, revenue, upcoming arrivals)
// Deploy: supabase functions deploy daily-jobs  (verify_jwt off: secret-gated)
// deno-lint-ignore-file no-explicit-any
import { createClient } from "../_shared/deps.ts";
import { sendMail, emailShell, kv, p, esc, money, fmtDate, emailConfigured, propertyBrand } from "../_shared/email.ts";
import { syncFeed } from "../_shared/sync.js";
import { computeWeeklyStats } from "../_shared/report.js";
import { addDaysISO } from "../_shared/ical.js";
import { allRows } from "../_shared/paged.ts";
import { logError } from "../_shared/errors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const todayISO = () => new Date().toISOString().slice(0, 10);

/* Step the current [weekStart, weekStart+7) window back to the most recent Monday. */
function lastMonday(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  return addDaysISO(iso, -((dow + 6) % 7));
}

async function reminders(kind: "checkin" | "checkout", out: Record<string, number>) {
  const tomorrow = addDaysISO(todayISO(), 1);
  const dateCol = kind === "checkin" ? "check_in" : "check_out";
  const flagCol = kind === "checkin" ? "checkin_reminder_sent_at" : "checkout_reminder_sent_at";
  const statuses = kind === "checkin" ? ["pending", "confirmed"] : ["confirmed", "checked_in"];
  // Collect every candidate first: sending flags rows, which would shift pages.
  const rows = await allRows(() => admin.from("reservations")
    .select("*, tenants(name, contact_phone, contact_email, currency, logo_url, booking_theme, booking_email, enquiry_email, phone, address_line1, city, state, postcode, website_url), rooms(code, name)")
    .eq(dateCol, tomorrow)
    .in("status", statuses)
    .not("guest_email", "is", null)
    .is(flagCol, null)
    .order("id"));
  let sent = 0;
  for (const r of rows) {
    const tenant: any = (r as any).tenants || {};
    const room: any = (r as any).rooms || {};
    const property = tenant.name || "Your property";
    const first = String(r.guest_name || "").split(" ")[0] || "there";
    const brand = propertyBrand(tenant);
    const html = kind === "checkin"
      ? emailShell("See you tomorrow",
          p(`Hi ${esc(first)},`) +
          p(`We're looking forward to welcoming you to <strong>${esc(property)}</strong> tomorrow.`) +
          kv([["Confirmation code", r.confirmation_code], ["Room", `${room.code || ""} ${room.name || ""}`.trim()], ["Check-in", fmtDate(r.check_in)], ["Check-out", fmtDate(r.check_out)]]),
          brand.replyTo || brand.phone
            ? `Running late or have a question? ${brand.replyTo ? "Just reply to this email" : `Call ${esc(property)}`}${brand.phone ? `${brand.replyTo ? " or call" : " at"} ${esc(brand.phone)}` : ""}.`
            : "", brand)
      : emailShell("Checkout tomorrow",
          p(`Hi ${esc(first)},`) +
          p(`A quick reminder that checkout at <strong>${esc(property)}</strong> is tomorrow, ${fmtDate(r.check_out)}. We hope you enjoyed your stay.`) +
          kv([["Confirmation code", r.confirmation_code], ["Room", `${room.code || ""} ${room.name || ""}`.trim()], ["Check-out", fmtDate(r.check_out)]]),
          brand.replyTo ? "Questions? Just reply to this email." : "", brand);
    const res = await sendMail({
      to: r.guest_email,
      fromName: brand.name,
      replyTo: brand.replyTo,
      subject: kind === "checkin" ? `See you tomorrow · ${property}` : `Checkout tomorrow · ${property}`,
      html
    }).catch(() => ({ sent: false }));
    if (res.sent) {
      sent++;
      await admin.from("reservations").update({ [flagCol]: new Date().toISOString() }).eq("id", r.id);
    }
  }
  out[kind === "checkin" ? "checkinReminders" : "checkoutReminders"] = sent;
}

async function weeklyReports(out: Record<string, number>) {
  const today = todayISO();
  if (new Date(today + "T12:00:00Z").getUTCDay() !== 1) return; // Mondays only (UTC)
  const weekStart = addDaysISO(lastMonday(today), -7); // the week that just ended
  const tenants = await allRows(() => admin.from("tenants").select("*").order("id"));
  let sent = 0;
  for (const t of tenants) {
    if (t.last_weekly_report_at && (Date.now() - new Date(t.last_weekly_report_at).getTime()) < 6 * 864e5) continue;
    const to = t.booking_email || t.contact_email;
    if (!to) continue;
    const [rooms, reservations, txns] = await Promise.all([
      allRows(() => admin.from("rooms").select("id, code, name").eq("tenant_id", t.id).order("id")),
      allRows(() => admin.from("reservations").select("*").eq("tenant_id", t.id).gte("check_out", addDaysISO(weekStart, -1)).order("id")),
      allRows(() => admin.from("transactions").select("*").eq("tenant_id", t.id).gte("created_at", weekStart).order("id"))
    ]);
    const roomName = new Map((rooms || []).map((r) => [r.id, `${r.code} · ${r.name}`]));
    const stats = computeWeeklyStats({
      roomCount: (rooms || []).length,
      reservations: reservations || [],
      transactions: txns || [],
      weekStart, today, arrivalWindowDays: 7
    });
    const arrivalRows = stats.arrivals.slice(0, 12).map((a) => {
      const r = (reservations || []).find((x) => x.confirmation_code === a.code);
      return `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#33413f;padding:3px 14px 3px 0">${fmtDate(a.checkIn)}</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#101f1e;padding:3px 14px 3px 0">${esc(a.guest)}</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5f7a73;padding:3px 0">${esc(r ? (roomName.get(r.room_id) || "") : "")}</td></tr>`;
    }).join("");
    const res = await sendMail({
      to,
      subject: `Your week at ${t.name} · ${stats.occupancyPct}% occupancy`,
      html: emailShell(`Your week at ${t.name}`,
        p(`Here's how <strong>${esc(t.name)}</strong> did last week (${fmtDate(stats.weekStart)} – ${fmtDate(addDaysISO(stats.weekEnd, -1))}), and who's arriving next.`) +
        kv([
          ["Occupancy", `${stats.occupancyPct}% (${stats.nightsBooked} of ${stats.possibleNights} room-nights)`],
          ["Revenue collected", money(stats.revenueCents, t.currency)],
          ["New bookings", String(stats.newBookings)],
          ["Arrivals next 7 days", String(stats.arrivals.length)]
        ]) +
        (arrivalRows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px">${arrivalRows}</table>` : p("No arrivals in the next 7 days.")),
        `You're receiving this because ${esc(t.name)} uses SimpleHotelier. Manage notification emails in Settings.`)
    }).catch(() => ({ sent: false }));
    if (res.sent) {
      sent++;
      await admin.from("tenants").update({ last_weekly_report_at: new Date().toISOString() }).eq("id", t.id);
    }
  }
  out.weeklyReports = sent;
}

Deno.serve(async (req) => {
  try {
    const given = req.headers.get("x-cron-secret") || "";
    const { data: cfg } = await admin.from("system_config").select("value").eq("key", "daily_jobs_secret").maybeSingle();
    if (!given || !cfg || cfg.value !== given) return json({ error: "unauthorized" }, 401);
    if (!emailConfigured()) return json({ error: "email not configured (SES_SMTP_* secrets)" }, 503);

    const out: Record<string, number> = {};
    await reminders("checkin", out);
    await reminders("checkout", out);

    const feeds = await allRows(() => admin.from("ical_feeds").select("*").order("id"));
    let imported = 0;
    for (const feed of feeds) {
      const r = await syncFeed(admin, feed);
      imported += r.imported || 0;
    }
    out.feedsSynced = feeds.length;
    out.blocksImported = imported;

    await weeklyReports(out);
    return json({ ok: true, ...out });
  } catch (e: any) {
    console.error("daily-jobs", e); await logError("daily-jobs", e);
    return json({ error: "daily-jobs failed" }, 500);
  }
});
