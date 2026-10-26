/* SimpleHotelier — sync one external iCal feed into blocked reservations.
   Plain ESM (Deno + Node). `admin` is a Supabase service-role client. */
import { parseICS, importCode } from "./ical.js";

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Replace a feed's upcoming imported blocks with the feed's current events.
 * Events overlapping a real (non-imported) reservation are skipped, never forced.
 * Returns { imported, skipped, error? } and records feed sync state.
 */
export async function syncFeed(admin, feed, fetchFn = fetch) {
  const done = async (result) => {
    await admin.from("ical_feeds").update({
      last_synced_at: new Date().toISOString(),
      last_error: result.error ? String(result.error).slice(0, 300) : null
    }).eq("id", feed.id);
    return result;
  };
  try {
    const res = await fetchFn(feed.url, { headers: { "User-Agent": "SimpleHotelier/1.0 (+https://simplehotelier.com)" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return done({ imported: 0, skipped: 0, error: `Feed returned HTTP ${res.status}` });
    const events = parseICS(await res.text());
    const today = todayISO();

    // Clear this feed's upcoming blocks, then re-import fresh.
    await admin.from("reservations").delete().eq("ical_feed_id", feed.id).gte("check_out", today);

    let imported = 0, skipped = 0;
    for (const e of events) {
      if (!e.uid || e.end <= today) continue;
      const { error } = await admin.from("reservations").insert({
        tenant_id: feed.tenant_id,
        room_id: feed.room_id,
        guest_name: feed.name,
        confirmation_code: importCode(e.uid),
        check_in: e.start,
        check_out: e.end,
        status: "confirmed",
        source: feed.source || "other",
        notes: e.summary ? `External booking: ${e.summary}`.slice(0, 300) : "External booking",
        ical_feed_id: feed.id,
        ical_uid: e.uid
      });
      if (error) { skipped++; continue; } // overlap exclusion or duplicate UID: skip, never double-book
      imported++;
    }
    return done({ imported, skipped });
  } catch (err) {
    return done({ imported: 0, skipped: 0, error: err?.message || "sync failed" });
  }
}
