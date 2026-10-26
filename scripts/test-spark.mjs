// SimpleHotelier — live Spark test: temp user -> sign in -> ask muse-spark -> cleanup.
// Usage: node scripts/test-spark.mjs   (no secrets printed)
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = {};
for (const line of readFileSync(root + ".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const keysRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
  headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}` }
});
if (!keysRes.ok) { console.error("api-keys fetch failed HTTP", keysRes.status); process.exit(1); }
const keys = await keysRes.json();
const service = (keys || []).find((k) => k.name === "service_role")?.api_key;
if (!service) { console.error("service_role key not found"); process.exit(1); }
const adminHeaders = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };

const email = `spark-test-${Date.now()}@example.com`;
const password = "Test-" + Math.random().toString(36).slice(2) + "-aA1!";
let userId = null;
try {
  const created = await fetch(url + "/auth/v1/admin/users", {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const cdata = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error("create user: " + (cdata.msg || created.status));
  userId = cdata.id;
  console.log("temp user created");

  const signin = await fetch(url + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const sdata = await signin.json().catch(() => ({}));
  if (!signin.ok || !sdata.access_token) throw new Error("sign in failed: " + signin.status);

  const ask = await fetch(url + "/functions/v1/support-ai", {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${sdata.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "How do I add a new cabin? Answer briefly." })
  });
  const adata = await ask.json().catch(() => ({}));
  console.log("support-ai HTTP", ask.status, "| model:", adata.model || "(none)");
  if (adata.answer) console.log("answer preview:", String(adata.answer).slice(0, 280).replace(/\s+/g, " "));
  else console.log("no answer:", JSON.stringify(adata).slice(0, 280));
  if (!ask.ok) process.exitCode = 1;
} finally {
  if (userId) {
    const del = await fetch(url + "/auth/v1/admin/users/" + userId, { method: "DELETE", headers: adminHeaders });
    console.log("temp user deleted:", del.ok ? "yes" : "HTTP " + del.status);
  }
}
console.log("SPARK TEST DONE");
