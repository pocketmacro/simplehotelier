// Focused test: a card is required to book online (Stripe-connected
// properties), cancellation wording is the same everywhere.
// Risks covered: (1) bookings with no deposit had no card to charge later;
// (2) abandoned card checkouts held rooms forever; (3) the confirmation email
// promised different cancellation terms than Settings and the booking page.
// Run: node --test tests/card-guarantee.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const book = read("js/book.js");
const html = read("app.html");
const send = read("supabase/functions/send-email/index.ts");
const charge = read("supabase/functions/charge-guest/index.ts");
const hook = read("supabase/functions/stripe-webhook/index.ts");
const sql = read("supabase/migrations/20261117000000_card_guarantee.sql");

test("booking page asks for a card whenever the property can take one", () => {
  assert.match(book, /function cardRequired\(\)/);
  assert.match(book, /if \(booked\.card_required && cfg\.STRIPE_PUBLISHABLE_KEY\) \{[\s\S]*await startCardStep\(\);/);
  assert.match(book, /action: "setup"/);
  assert.match(book, /confirmCardSetup\(/);
  assert.match(book, /action: "confirm_setup"/);
});

test("confirmation email waits for the card when a card is required", () => {
  const afterBooking = book.slice(book.indexOf("state.booked = { resId"), book.indexOf("} catch (e) {", book.indexOf("state.booked = { resId")));
  const cardBranch = afterBooking.slice(0, afterBooking.indexOf("return;"));
  assert.doesNotMatch(cardBranch, /booking_confirmation/, "no email before the card is in");
  const pay = book.slice(book.indexOf("async function payDeposit()"), book.indexOf("function cancellationText("));
  assert.equal((pay.match(/action: "booking_confirmation"/g) || []).length, 2, "sent after card saved and after deposit paid");
});

test("charge-guest saves guarantee cards with SetupIntents, never charging them", () => {
  const setup = charge.slice(charge.indexOf("async function setup("), charge.indexOf("async function confirmSetup("));
  assert.match(setup, /stripe\.setupIntents\.create\(/);
  assert.match(setup, /usage: "off_session"/);
  assert.match(setup, /on_behalf_of: tenant\.stripe_account_id/);
  assert.doesNotMatch(setup, /paymentIntents/);
  assert.match(setup, /!resv\.card_required/);
  assert.match(charge, /si\.metadata\?\.tenant_id !== tenant\.id/);
  assert.match(hook, /event\.type === "setup_intent\.succeeded"/);
});

test("abandoned card checkouts stop holding rooms after 30 minutes", () => {
  assert.match(sql, /r\.card_required\s+and r\.stripe_payment_method_id is null and r\.paid_cents = 0\s+and r\.created_at < now\(\) - interval '30 minutes'/);
  assert.match(sql, /perform public\.release_abandoned_holds\(p_tenant\);/);
  assert.match(sql, /cron\.schedule\('simplehotelier-release-holds', '\*\/10 \* \* \* \*'/);
  assert.match(sql, /revoke execute on function public\.release_abandoned_holds\(uuid\) from public, anon, authenticated/);
});

test("cancellation wording matches across Settings, booking page and emails", () => {
  const pageText = {};
  for (const m of book.matchAll(/(flexible|moderate|strict): "([^"]+)"/g)) pageText[m[1]] = m[2];
  const emailText = {};
  for (const m of send.matchAll(/(flexible|moderate|strict): "([^"]+)"/g)) emailText[m[1]] = m[2];
  assert.deepEqual(Object.keys(pageText).sort(), ["flexible", "moderate", "strict"]);
  assert.deepEqual(emailText, pageText, "email presets = booking page presets");
  const settings = html.match(/<select class="select" id="pfPolicy">([\s\S]*?)<\/select>/)[1];
  assert.match(settings, /Moderate — full refund to 7 days/);
  assert.match(pageText.moderate, /full refund if you cancel at least 7 days/);
  assert.match(settings, /Flexible — full refund to 48 hours/);
  assert.match(pageText.flexible, /full refund if you cancel at least 48 hours/);
  assert.match(settings, /Strict — 50% refund to 14 days/);
  assert.match(pageText.strict, /50% refund if you cancel at least 14 days/);
  assert.match(send, /tenant\?\.cancellation_policy === "custom"\s*\? \(tenant\?\.cancellation_policy_text \|\| ""\)/, "custom policies word-for-word");
});
