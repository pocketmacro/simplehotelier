/* SimpleHotelier — sync one external iCal feed into blocked reservations.
   Plain ESM (Deno + Node). `admin` is a Supabase service-role client. */
import { parseICS, importCode } from "./ical.js";
import { feedUrlProblem } from "./origin.js";
import { SITE } from "./site.js";

const todayISO = () => new Date().toISOString().slice(0, 10);
const MAX_FEED_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

/* Fetch an owner-supplied feed URL without letting it point the server at
   internal hosts: every hop (including redirects) must pass feedUrlProblem,
   and the body is capped. Throws with a sentence for the owner on refusal. */
async function fetchFeed(url, fetchFn) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = feedUrlProblem(current);
    if (problem) throw new Error(problem);
    const res = await fetchFn(current, {
      headers: { "User-Agent": `${SITE.name.replace(/\s+/g, "")}/1.0 (+${SITE.siteUrl})` },
      redirect: "manual",
      signal: AbortSignal.timeout(20000)
    });
    const location = res.status >= 300 && res.status < 400 && res.headers && res.headers.get("location");
    if (location) { current = new URL(location, current).toString(); continue; }
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
    const declared = Number(res.headers && res.headers.get("content-length"));
    if (declared > MAX_FEED_BYTES) throw new Error("Feed is too large");
    const text = await res.text();
    if (text.length > MAX_FEED_BYTES) throw new Error("Feed is too large");
    return text;
  }
  throw new Error("Feed redirected too many times");
}

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
    const events = parseICS(await fetchFeed(feed.url, fetchFn));
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
