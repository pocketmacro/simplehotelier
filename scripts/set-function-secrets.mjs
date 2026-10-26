// SimpleHotelier — push selected .env values into Supabase Edge Function secrets.
// Usage: node scripts/set-function-secrets.mjs SES_SMTP_HOST SES_SMTP_USER SES_SMTP_PASS
// Values are never printed; only key names and the HTTP status are reported.
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = {};
for (const line of readFileSync(root + ".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref || !env.SUPABASE_TOKEN) { console.error("ABORT: .env needs SUPABASE_TOKEN + NEXT_PUBLIC_SUPABASE_URL"); process.exit(1); }
const keys = process.argv.slice(2);
if (!keys.length) { console.error("usage: node scripts/set-function-secrets.mjs KEY [KEY...]"); process.exit(1); }
const payload = keys.map((name) => {
  if (!env[name]) { console.error("ABORT: " + name + " missing from .env"); process.exit(1); }
  return { name, value: env[name] };
});
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
console.log("Function secrets set (" + keys.join(", ") + "): HTTP", res.status);
if (!res.ok) { console.error((await res.text()).slice(0, 300)); process.exit(1); }
