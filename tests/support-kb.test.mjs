// Focused test: Spark support assistant routing in js/support.js (offline KB).
// Run: node --test tests/support-kb.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { SH_CONFIG: {} };
eval(readFileSync(new URL("../js/site.js", import.meta.url), "utf8")); // window.SH_SITE
globalThis.document = { querySelector: () => null, addEventListener: () => {} };
globalThis.location = { search: "", protocol: "https:", origin: "https://example.com" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

eval(readFileSync(new URL("../js/support.js", import.meta.url), "utf8"));

test("routes cabin question to the add-room article", () => {
  assert.equal(typeof window.SHSupport, "object", "SHSupport must be exposed");
  const a = window.SHSupport.answer("How do I add a new cabin?");
  assert.match(a.title + a.body, /Rooms/i);
});

test("routes embed question to the embed article", () => {
  const a = window.SHSupport.answer("How do I embed booking on my website?");
  assert.match(a.title + a.body, /embed/i);
});

test("unknown question falls back and offers a support case", () => {
  const a = window.SHSupport.answer("Why is the moon green on Tuesdays?");
  assert.equal(a.fallback, true);
  assert.match(a.body, /support case/i);
});

test("findLinks maps screen names in answers to app views", () => {
  assert.equal(typeof window.SHSupport.findLinks, "function", "SHSupport.findLinks must exist");
  const links = window.SHSupport.findLinks("Open Add-ons & Taxes and choose Add-on. See the Booking Page too.");
  assert.deepEqual(links.map((l) => l.view), ["addons", "booking"]);
  assert.equal(window.SHSupport.findLinks("Go to Payments, then Payments again").length, 1);
});
