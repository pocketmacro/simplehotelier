// Focused test: reservation editor + real guest payments.
// Risks covered: (1) the dashboard "Charge" recorded payments as paid without
// charging any card and offered a made-up "Visa **** 3098 (on file)";
// (2) reservations could not be edited; (3) prices for staff bookings were
// computed in the browser; (4) the platform took a 1% fee from properties;
// (5) refunds / payment links / webhook payments double counting; (6) the
// dashboard's "today" was frozen at Oct 26 2026.
// Run: node --test tests/reservation-editor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const db = read("js/db.js");
const rxjs = read("js/reservation.js");
const html = read("app.html");
const charge = read("supabase/functions/charge-guest/index.ts");
const hook = read("supabase/functions/stripe-webhook/index.ts");
const send = read("supabase/functions/send-email/index.ts");
const sql = read("supabase/migrations/20261116000000_reservation_editor.sql");

test("no fake charges or fake card on file remain in the dashboard", () => {
  assert.doesNotMatch(app, /Visa \*\*\*\* 3098 \(on file\)/);
  assert.doesNotMatch(app, /a === "run-charge"|a === "cash-done"|function openCharge|function openNewReservation/);
  assert.doesNotMatch(app, /updateReservationPaid\(/, "paid amounts move only through database functions");
  assert.doesNotMatch(rxjs, /updateReservationPaid|addTransaction\(/);
});

test("every reservation entry point opens the editor", () => {
  assert.match(app, /function openResDetail\(ref\) \{ openReservationEditor\(ref\); \}/);
  assert.match(app, /a === "new-reservation"\) openReservationEditor\(null\)/);
  assert.match(app, /openReservationEditor\(ref, \{ panel: "charge" \}\)/);
  assert.match(app, /a === "record-cash"\) openReservationPicker\("record"\)/);
  assert.ok(html.indexOf('src="js/reservation.js"') > html.indexOf('src="js/app.js"'), "editor loads after app.js");
});

test("editor saves and prices through the database, never browser totals", () => {
  assert.match(rxjs, /SHDB\.saveReservation\(/);
  assert.match(rxjs, /SHDB\.staffQuote\(/);
  const start = rxjs.indexOf("await SHDB.saveReservation({");
  const payload = rxjs.slice(start, rxjs.indexOf("});", start));
  assert.ok(start > 0 && payload.includes("p_room:"));
  assert.doesNotMatch(payload, /total|tax_cents|subtotal|paid/, "live save sends no money fields");
  assert.match(db, /rpc\("save_reservation"/);
  assert.match(db, /rpc\("staff_quote"/);
});

test("card charges use the card on file through charge-guest; cash is recorded, not charged", () => {
  assert.match(rxjs, /action: "charge_card"/);
  assert.match(rxjs, /action: "payment_request"/);
  assert.match(rxjs, /action: "refund"/);
  assert.match(rxjs, /SHDB\.recordManualPayment\(/);
  assert.match(rxjs, /no card is charged/i);
});

test("charge-guest: card on file, payment links, refunds; no platform fee", () => {
  assert.doesNotMatch(charge, /application_fee_amount/, "properties keep every cent");
  assert.match(charge, /setup_future_usage: "off_session"/);
  assert.match(charge, /off_session: true,\s*confirm: true/);
  assert.match(charge, /checkAmount\(body\.amount_cents, outstanding\(resv\)\)/, "staff amounts capped at the balance");
  assert.match(charge, /frontDesk\(req, tenant\.id, \["owner", "admin"\]\)/, "refunds: owner/admin only");
  assert.match(charge, /reverse_transfer: true/);
  assert.match(charge, /stripe\.checkout\.sessions\.create\(/);
  assert.match(charge, /rpc\("record_stripe_refund"/);
});

test("webhook records payment links, card-on-file charges and Dashboard refunds", () => {
  assert.match(hook, /s\.metadata\?\.kind === "payment_request"/);
  assert.match(hook, /event\.type === "charge\.refunded"/);
  assert.match(hook, /saveCardFromIntent\(/);
  assert.doesNotMatch(hook, /"handler error: " \+/, "no raw errors back to Stripe");
});

test("staff can re-send confirmations; guests cannot", () => {
  assert.match(send, /if \(!body\.force\) return await bookingConfirmation/);
  assert.match(send, /\["owner", "admin", "staff"\]\.includes\(role\)/);
});

test("database: role checks, validated methods, idempotent money", () => {
  assert.match(sql, /has_tenant_role\(p_tenant, array\['owner', 'admin', 'staff'\]\)/);
  assert.match(sql, /v_method not in \('Cash', 'Bank transfer', 'Check', 'Other'\)/);
  assert.match(sql, /create unique index if not exists idx_txn_payment_intent/);
  assert.match(sql, /create unique index if not exists idx_txn_refund/);
  assert.match(sql, /on conflict \(stripe_payment_intent_id\) where stripe_payment_intent_id is not null do nothing/);
  assert.match(sql, /Anything that changes the price always reprices/);
  assert.match(sql, /revoke execute on function public\.record_stripe_refund\(text, text, int\) from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.save_reservation\([^)]*\) from public, anon/);
});

test("the dashboard clock is today, not a hardcoded date", () => {
  assert.doesNotMatch(app, /new Date\(2026, 9, 26\)/);
  assert.doesNotMatch(db, /new Date\(2026, 9, 26\)/);
  assert.doesNotMatch(html, /Monday, Oct 26, 2026/);
  assert.match(app, /function renderDateCtx\(\)/);
});
