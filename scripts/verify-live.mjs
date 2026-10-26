// SimpleHotelier — live smoke check (site + Edge Functions). No secrets printed.
// Usage: node scripts/verify-live.mjs
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = {};
for (const line of readFileSync(root + ".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const site = "https://simplehotelier.pocketmacro.workers.dev";
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

async function check(label, url, opts) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
    const text = await r.text();
    const title = (text.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    console.log(`${label}: HTTP ${r.status}${title ? " | " + title.slice(0, 60) : ""}${opts?.expect ? " | body: " + text.slice(0, 80).replace(/\s+/g, " ") : ""}`);
  } catch (e) {
    console.log(`${label}: FAILED ${e.message}`);
  }
}

await check("landing /", site + "/");
await check("dashboard /app.html", site + "/app.html");
await check("booking /book.html", site + "/book.html?property=pinecrest");
await check("support-ai (expect 501 ai_not_configured)", `https://${ref}.supabase.co/functions/v1/support-ai`, {
  method: "POST", expect: true,
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ question: "ping" })
});
await check("create-checkout (expect 401 not signed in)", `https://${ref}.supabase.co/functions/v1/create-checkout`, {
  method: "POST", expect: true,
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ tenant_id: "11111111-1111-1111-1111-111111111111" })
});
console.log("VERIFY DONE");
