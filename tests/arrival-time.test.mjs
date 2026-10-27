// Focused test: guests pick an estimated arrival time when they book.
// It must use the same windows the front desk picks from in the reservation
// editor (so it fills that field), pass the Turnstile-gated function's
// allowlist, be validated by create_booking(), and show on the dashboard.
// tests/rls/checks.sql R55 proves the database side against live.
// Run: node --test tests/arrival-time.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const editorWindows = JSON.parse(read("js/reservation.js").match(/const RX_ARRIVALS = (\[[^\]]+\]);/)[1]).filter(Boolean);

test("the booking page offers exactly the editor's arrival windows", () => {
  const html = read("book.html");
  const select = html.match(/<select class="bk-input" id="gArrival">([\s\S]*?)<\/select>/)[1];
  assert.match(select, /^<option value="">Not sure yet<\/option>/);
  assert.deepEqual([...select.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]), editorWindows);
  assert.match(read("js/book.js"), /p_arrival_time: \$\("#gArrival"\)\.value \|\| null/);
});

test("create_booking accepts only those windows and stores them", () => {
  const sql = read("supabase/migrations/20261124000000_booking_arrival_time.sql");
  const allowed = sql.match(/<> all \(array\[([^\]]+)\]\)/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(allowed, editorWindows);
  assert.match(sql, /raise exception 'invalid_arrival_time'/);
  assert.match(sql, /card_required, arrival_time\)/);
  assert.match(sql, /grant execute on function public\.create_booking\([^)]*, text, text\) to service_role;/);
  assert.match(read("supabase/functions/create-booking/index.ts"), /"p_terms_accepted", "p_arrival_time"\]/);
});

test("the dashboard and emails show the arrival window", () => {
  assert.match(read("js/db.js"), /arrival: r\.arrival_time \|\| ""/);
  const app = read("js/app.js");
  assert.match(app, /<small class="res-arrival">Arrives \$\{esc\(r\.arrival\)\}<\/small>/);
  assert.match(app, /tag === "Arriving" && r\.arrival \? " " \+ esc\(r\.arrival\) : ""/);
  assert.match(read("supabase/functions/send-email/index.ts"), /\["Estimated arrival", String\(r\.arrival_time\)\]/);
});
