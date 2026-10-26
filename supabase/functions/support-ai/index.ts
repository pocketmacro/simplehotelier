// SimpleHotelier — Spark, the in-app support assistant (muse-spark powered).
// POST { question } with the user's JWT -> { answer }
// Secret: ANTHROPIC_API_KEY (without it, returns 501 and the app uses its
// built-in help articles). Optional secret: AI_MODEL.
// Deploy: supabase functions deploy support-ai
// deno-lint-ignore-file no-explicit-any

const SYSTEM = `You are Spark, the friendly support assistant inside SimpleHotelier, a $30/month system for cabins and small hotels.
Help owners do things in the app and explain features briefly with numbered steps.
Cover: adding rooms, rates, reservations, calendar, housekeeping flags, charging guests (Stripe Connect), add-ons, taxes, booking page, embedding, Google Analytics, reports, inviting cleaners, billing.
If you cannot solve it, say so plainly and suggest opening a support case. Never invent buttons that do not exist. Keep answers under 180 words.`;

Deno.serve(async (req) => {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ai_not_configured" }, 501);
  try {
    const { question } = await req.json();
    if (!question) return json({ error: "question required" }, 400);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("AI_MODEL") || "claude-sonnet-4-5",
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: "user", content: String(question).slice(0, 2000) }],
      }),
    });
    const data: any = await res.json();
    if (!res.ok) return json({ error: data?.error?.message || "ai_error" }, 502);
    const answer = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return json({ answer });
  } catch (e: any) {
    return json({ error: e.message ?? "support-ai failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
