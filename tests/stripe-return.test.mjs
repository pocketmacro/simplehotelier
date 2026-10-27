// Focused test: Stripe return URLs land on real pages, not 404s.
// Regression: Connect sent owners to /settings?stripe=done (no such route).
// Run: node --test tests/stripe-return.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const connect = readFileSync(new URL("../supabase/functions/stripe-connect/index.ts", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../supabase/functions/create-checkout/index.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

test("stripe-connect returns to the dashboard app, not a bare /settings path", () => {
  assert.doesNotMatch(connect, /"\/settings\?/);
  assert.match(connect, /"\/app\.html\?stripe=done"/);
  assert.match(connect, /"\/app\.html\?stripe=refresh"/);
});

test("subscription checkout returns to the dashboard app", () => {
  assert.match(checkout, /"\/app\.html\?checkout=success"/);
  assert.match(checkout, /"\/app\.html\?checkout=cancelled"/);
});

test("the app greets Stripe Connect returns and routes to Settings", () => {
  assert.match(app, /get\("stripe"\)/);
  assert.match(app, /toast\("Stripe connected"/);
});

test("connect status syncs from Stripe (source of truth) into the tenant flag", () => {
  assert.match(connect, /action === "status"/);
  assert.match(connect, /charges_enabled && account\.details_submitted/);
  assert.match(connect, /stripe_onboarding_complete: connected/);
  assert.match(app, /async function syncStripeStatus\(\)/);
  assert.match(app, /btn\.textContent = x\.done \? "Connected ✓" : "Connect"/);
});
