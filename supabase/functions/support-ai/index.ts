// SimpleHotelier — Spark, the in-app support assistant, powered by muse-spark
// through the Meta Model API (OpenAI-compatible Chat Completions).
// POST { question } with the user's JWT -> { answer, model }
// Secrets: MODEL_API_KEY (from developer.meta.com). Optional: META_MODEL
// (default muse-spark-1.3). Without the key, returns 501 and the app uses
// its built-in help articles. Signed-in users only (paid external API).
// Deploy: supabase functions deploy support-ai
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SYSTEM = `You are Spark, the friendly support assistant inside SimpleHotelier, a $30/month system for cabins and small hotels.
Help owners do things in the app and explain features briefly with numbered steps.
Cover: adding rooms, rates, reservations, calendar, housekeeping flags, charging guests (Stripe Connect), add-ons, taxes, booking page, embedding, Google Analytics, reports, inviting cleaners, billing.
If you cannot solve it, say so plainly and suggest opening a support case. Never invent buttons that do not exist. Keep answers under 180 words.`;

Deno.serve(async (req) => {
  const key = Deno.env.get("MODEL_API_KEY") || Deno.env.get("META_API_KEY");
  if (!key) return json({ error: "ai_not_configured" }, 501);
  try {
    // Paid API: require a signed-in SimpleHotelier user.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);

    const { question } = await req.json();
    if (!question) return json({ error: "question required" }, 400);
    const model = Deno.env.get("META_MODEL") || "muse-spark-1.3";
    const res = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: String(question).slice(0, 2000) },
        ],
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: data?.error?.message || "meta_api_error", status: res.status }, 502);
    const answer = data?.choices?.[0]?.message?.content || "";
    if (!answer) return json({ error: "empty_answer" }, 502);
    return json({ answer, model });
  } catch (e: any) {
    return json({ error: e.message ?? "support-ai failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
