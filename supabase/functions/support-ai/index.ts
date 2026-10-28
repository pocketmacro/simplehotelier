// SimpleHotelier — Spark, the in-app support assistant, powered by muse-spark
// through the Meta Model API (OpenAI-compatible Chat Completions).
// POST { question } with the user's JWT -> { answer, model }
// Secrets: MODEL_API_KEY (from developer.meta.com). Optional: META_MODEL
// (default muse-spark-1.3). Without the key, returns 501 and the app uses
// its built-in help articles. Signed-in users only (paid external API), and at
// most SPARK_DAILY_LIMIT questions per user per day (default 40).
// Deploy: supabase functions deploy support-ai
// deno-lint-ignore-file no-explicit-any
import { createClient } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";
import { SITE } from "../_shared/site.js";

const SYSTEM = `You are Spark, the friendly support assistant inside ${SITE.name}, a ${SITE.priceLabel}/month system for cabins and small hotels.
Help owners do things in the app and explain features briefly with numbered steps.
Use ONLY these real screen and button names: Overview, Reservations, Calendar, Rooms & Cabins (Add unit), Housekeeping, Payments (Charge), Add-ons & Taxes, Booking Page (Publish changes), Reports, Support, Settings (Plan and billing), System Admin (admins only).
Always mention the destination screen by its exact name in your answer: the app turns exact screen names into buttons that take the user there.
Cover: adding rooms, rates, reservations, calendar, housekeeping flags, charging guests (Stripe Connect), add-ons, taxes, booking page, embedding, Google Analytics, reports, inviting cleaners, billing.
If you cannot solve it, say so plainly and suggest opening a support case. Never invent buttons or screens. Keep answers under 180 words.`;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const DAILY_LIMIT = Number(Deno.env.get("SPARK_DAILY_LIMIT")) || 40;

const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("MODEL_API_KEY") || Deno.env.get("META_API_KEY");
  if (!key) return json({ error: "ai_not_configured" }, 501);
  try {
    // Paid API: require a signed-in user.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);
    // Support is for the people who run a property (not housekeeping/maintenance).
    const { data: desk } = await admin.from("tenant_members").select("role")
      .eq("user_id", user.id).in("role", ["owner", "admin", "staff"]).limit(1);
    if (!desk || !desk.length) return json({ error: "Support is for property owners, admins and the front desk." }, 403);

    const { question } = await req.json();
    if (!question) return json({ error: "question required" }, 400);
    // Count the question before paying for it; refuse past today's limit.
    const { data: used, error: usageErr } = await admin.rpc("bump_ai_usage", { p_user: user.id });
    if (usageErr) { console.error("support-ai usage", usageErr); await logError("support-ai", usageErr); return json({ error: "usage_check_failed" }, 503); }
    if (Number(used) > DAILY_LIMIT) return json({ error: "daily_limit", limit: DAILY_LIMIT }, 429);
    const model = Deno.env.get("META_MODEL") || "muse-spark-1.3";
    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: String(question).slice(0, 2000) },
    ];
    // Reasoning models spend a variable number of tokens thinking before the
    // final answer. Start at 1500; if the reply comes back empty, retry once
    // with a much larger budget instead of failing the user.
    let lastStatus = 0;
    for (const maxTokens of [1500, 4000]) {
      const res = await fetch("https://api.meta.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      });
      lastStatus = res.status;
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: data?.error?.message || "meta_api_error", status: res.status }, 502);
      const raw = data?.choices?.[0]?.message?.content;
      const answer = Array.isArray(raw) ? raw.map((p: any) => p?.text || "").join("") : (raw || "");
      if (answer.trim()) return json({ answer, model });
    }
    return json({ error: "empty_answer", status: lastStatus }, 502);
  } catch (e: any) {
    console.error("support-ai", e); await logError("support-ai", e);
    return json({ error: "support-ai failed" }, 500);
  }
}));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
