// SimpleHotelier — apply one SQL migration file via the Management API (chunked).
// Usage: node scripts/apply-sql.mjs supabase/migrations/<file>.sql
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
const file = process.argv[2];
if (!file) { console.error("usage: node scripts/apply-sql.mjs <sql-file>"); process.exit(1); }

const text = readFileSync(root + file.replaceAll("\\", "/"), "utf8");
const chunks = text.split(/^-- @@CHUNK@@.*$/m).map((s) => s.trim()).filter(Boolean);
for (let i = 0; i < chunks.length; i++) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: chunks[i] })
  });
  const body = await res.text();
  if (!res.ok) { console.error(`chunk ${i + 1}/${chunks.length} FAILED HTTP ${res.status}: ${body.slice(0, 400)}`); process.exit(1); }
  console.log(`chunk ${i + 1}/${chunks.length}: OK`);
}
console.log("APPLIED", file);
