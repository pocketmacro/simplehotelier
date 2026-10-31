// Focused test: the webhook endpoint setup-platform.mjs creates subscribes to
// every event stripe-webhook handles, at the API version the functions use.
// Regression: phase2 registered 4 of 7 events, so guest payments, card
// guarantees and refunds never synced on a fresh (live) endpoint.
// Run: node --test tests/stripe-webhook-events.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const setup = readFileSync(new URL("../scripts/setup-platform.mjs", import.meta.url), "utf8");
const hook = readFileSync(new URL("../supabase/functions/stripe-webhook/index.ts", import.meta.url), "utf8");

test("the webhook endpoint subscribes to every event stripe-webhook handles", () => {
  const list = setup.match(/const WEBHOOK_EVENTS = \[([\s\S]*?)\];/);
  assert.ok(list, "WEBHOOK_EVENTS list not found");
  const subscribed = new Set([...list[1].matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]));
  const handled = new Set([...hook.matchAll(/event\.type === "([a-z_.]+)"/g)].map((m) => m[1]));
  assert.ok(handled.size >= 7, "expected stripe-webhook to handle at least 7 events");
  assert.deepEqual([...subscribed].sort(), [...handled].sort());
});

test("the webhook endpoint is pinned to the functions' Stripe API version", () => {
  const pinned = setup.match(/const API_VERSION = "([\d-]+)";/)?.[1];
  const sdk = hook.match(/apiVersion: "([\d-]+)"/)?.[1];
  assert.ok(pinned && sdk);
  assert.equal(pinned, sdk);
  assert.match(setup, /api_version: API_VERSION/);
});
