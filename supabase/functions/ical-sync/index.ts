// SimpleHotelier — pull an Airbnb/Vrbo calendar into blocked dates.
// POST { feed_id }                  (signed-in tenant member; from the app)
// POST { action: "sync_all" }       (x-cron-secret header; from daily-jobs)
// Deploy: supabase functions deploy ical-sync
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncFeed } from "../_shared/sync.js";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function cronSecretOk(req: Request) {
  const given = req.headers.get("x-cron-secret") || "";
  if (!given) return false;
  const { data } = await admin.from("system_config").select("value").eq("key", "daily_jobs_secret").maybeSingle();
  return !!data && data.value === given;
}

async function memberOf(req: Request, tenantId: string) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await admin.auth.getUser(token);
  if (!data?.user) return false;
  const { data: mem } = await admin.from("tenant_members").select("user_id").eq("tenant_id", tenantId).eq("user_id", data.user.id).maybeSingle();
  return !!mem;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "sync_all") {
      if (!(await cronSecretOk(req))) return json({ error: "unauthorized" }, 401);
      const { data: feeds } = await admin.from("ical_feeds").select("*");
      const results = [];
      for (const feed of feeds || []) results.push({ feed: feed.id, ...(await syncFeed(admin, feed)) });
      return json({ feeds: results.length, results });
    }
    if (!body.feed_id) return json({ error: "feed_id required" }, 400);
    const { data: feed } = await admin.from("ical_feeds").select("*").eq("id", body.feed_id).maybeSingle();
    if (!feed) return json({ error: "feed not found" }, 404);
    if (!(await memberOf(req, feed.tenant_id)) && !(await cronSecretOk(req))) return json({ error: "unauthorized" }, 401);
    const result = await syncFeed(admin, feed);
    return json(result, result.error ? 502 : 200);
  } catch (e: any) {
    console.error("ical-sync", e);
    return json({ error: "ical-sync failed" }, 500);
  }
});
