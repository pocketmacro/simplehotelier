// Focused test: booking price math in js/book.js (room + add-ons + taxes).
// Run: node --test tests/book-calc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { SH_CONFIG: {} };
globalThis.document = { querySelector: () => null, addEventListener: () => {} };
globalThis.location = { search: "", protocol: "https:", origin: "https://example.com" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

eval(readFileSync(new URL("../js/book.js", import.meta.url), "utf8"));

test("quote: room-only percent tax excludes add-ons, per-night fee stacks", () => {
  assert.equal(typeof window.SHBookCalc, "object", "SHBookCalc must be exposed");
  const q = window.SHBookCalc.quote({
    rate: 200, nights: 2, guests: 2,
    addons: [{ name: "Firewood", price: 18, per: "stay", qty: 1 }, { name: "Cot", price: 20, per: "night", qty: 1 }],
    taxes: [
      { name: "Lodging", kind: "percent", value: 10, applies: "Room only" },
      { name: "Tourism", kind: "night", value: 2.5, applies: "Per night" }
    ]
  });
  // room 400; addons 18 + 40 = 58; lodging 10% of room = 40; tourism 2.50 x 2 = 5
  assert.equal(q.subtotal, 400);
  assert.equal(q.addonsTotal, 58);
  assert.equal(q.taxTotal, 45);
  assert.equal(q.total, 503);
});

test("quote: percent on Room + add-ons includes add-ons; per-person scales with guests", () => {
  const q = window.SHBookCalc.quote({
    rate: 100, nights: 1, guests: 3,
    addons: [{ name: "Breakfast", price: 10, per: "person", qty: 1 }],
    taxes: [{ name: "VAT", kind: "percent", value: 10, applies: "Room + add-ons" }]
  });
  // room 100; addons 30; VAT 10% of 130 = 13
  assert.equal(q.addonsTotal, 30);
  assert.equal(q.taxTotal, 13);
  assert.equal(q.total, 143);
});
