// SimpleHotelier — subscribe Airbnb/Vrbo to this property's booked dates.
// GET https://<ref>.supabase.co/functions/v1/ical-export?property={slug}&token={ical_token}&room={code?}
// The token is per property (Settings -> Booking page -> External calendars)
// so the feed URL works in Airbnb/Vrbo without exposing an account login.
// Deploy: supabase functions deploy ical-export  (verify_jwt off: token-gated)
import { createClient } from "../_shared/deps.ts";
import { buildICS } from "../_shared/ical.js";
import { allRows } from "../_shared/paged.ts";
import { logError } from "../_shared/errors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  try {
    return await exportFeed(req);
  } catch (e) {
    console.error("ical-export", e);
    await logError("ical-export", e);
    return text("Calendar temporarily unavailable", 500);
  }
});

async function exportFeed(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("property") || "";
  const token = url.searchParams.get("token") || "";
  const roomCode = url.searchParams.get("room") || "";
  if (!slug || !token) return text("Missing property or token", 400);

  const { data: tenant } = await admin.from("tenants").select("id, name, ical_token").eq("slug", slug).maybeSingle();
  if (!tenant || !tenant.ical_token || tenant.ical_token !== token) return text("Invalid calendar link", 403);

  let roomQuery = admin.from("rooms").select("id, code, name").eq("tenant_id", tenant.id);
  if (roomCode) roomQuery = roomQuery.eq("code", roomCode);
  const { data: rooms } = await roomQuery;
  if (!rooms || !rooms.length) return text("No rooms found", 404);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const reservations = await allRows(() => admin.from("reservations")
    .select("id, confirmation_code, check_in, check_out, room_id, status")
    .eq("tenant_id", tenant.id)
    .in("room_id", rooms.map((r) => r.id))
    .in("status", ["pending", "confirmed", "checked_in"])
    .gte("check_out", since)
    .order("check_in")
    .order("id"));

  const events = reservations.map((r) => {
    const room = roomById.get(r.room_id);
    return {
      uid: `${r.confirmation_code}@simplehotelier.com`,
      start: String(r.check_in).slice(0, 10),
      end: String(r.check_out).slice(0, 10),
      summary: roomCode ? "Reserved" : `Reserved · ${room ? room.code + " " + room.name : ""}`.trim(),
      description: `SimpleHotelier booking ${r.confirmation_code}`
    };
  });

  return new Response(buildICS(events, `${tenant.name} · SimpleHotelier`), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}.ics"`,
      "Cache-Control": "public, max-age=900"
    }
  });
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
