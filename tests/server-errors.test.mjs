// Focused test: Edge Function errors reach Site errors (System Admin).
// Risk covered: server failures (payments, emails, bookings, calendar sync)
// only went to Supabase's function logs, which nobody watches. Every error
// path now also calls logError(), which records through log_server_error()
// (service role only) and can never throw. R104 proves the SQL side on live.
// Run: node --test tests/server-errors.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const fnDir = new URL("../supabase/functions/", import.meta.url);
const functions = readdirSync(fnDir).filter((n) => !n.startsWith("_") && existsSync(new URL(n + "/index.ts", fnDir)));

test("every console.error in a function is followed by logError", () => {
  for (const name of functions) {
    const src = read(`supabase/functions/${name}/index.ts`);
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("console.error(")) return;
      const near = line + "\n" + (lines[i + 1] || "");
      assert.match(near, /await logError\(/, `${name}:${i + 1} logs to the console but not to Site errors`);
    });
    if (src.includes("console.error(")) assert.match(src, /import \{ logError \} from "\.\.\/_shared\/errors\.ts";/, name);
  }
});

test("ical-export, the one function without a handler, now catches and logs", () => {
  const src = read("supabase/functions/ical-export/index.ts");
  assert.match(src, /return await exportFeed\(req\);\s+\} catch \(e\) \{\s+console\.error\("ical-export", e\);\s+await logError\("ical-export", e\);/);
});

test("failed email sends are logged, then rethrown for the caller", () => {
  const email = read("supabase/functions/_shared/email.ts");
  assert.match(email, /\} catch \(e\) \{[\s\S]*?await logError\("email", e\);\s+throw e;/);
});

test("logError never throws and never sends request bodies", () => {
  const src = read("supabase/functions/_shared/errors.ts");
  assert.match(src, /\} catch \{\s+\/\/ swallow/);
  assert.match(src, /rpc\("log_server_error", \{ p_function: fn, p_message: message, p_stack: stack, p_tenant: tenant \}\)/);
  assert.doesNotMatch(src, /req\.|body|headers/i);
});

test("only the server can write server errors", () => {
  const sql = read("supabase/migrations/20261126000000_server_error_log.sql");
  assert.match(sql, /revoke execute on function public\.log_server_error\(text, text, text, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.log_server_error\(text, text, text, uuid\) to service_role;/);
  assert.match(sql, /on conflict \(day, fingerprint\) do update set count = e\.count \+ 1/);
  assert.match(read("js/support.js"), /e\.page === "server" \? "Server"/);
});
