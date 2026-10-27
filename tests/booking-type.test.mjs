// Focused test: book-by-type unit assignment helper in js/book.js.
// Run: node --test tests/booking-type.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { SH_CONFIG: {} };
globalThis.document = { querySelector: () => null, addEventListener: () => {} };
globalThis.location = { search: "", protocol: "https:", origin: "https://example.com" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

eval(readFileSync(new URL("../js/book.js", import.meta.url), "utf8"));

const units = [{ id: "u1" }, { id: "u2" }, { id: "u3" }];

test("chooseUnits returns free units in assignment order", () => {
  const { chooseUnits } = window.SHBookCalc;
  assert.equal(typeof chooseUnits, "function", "SHBookCalc.chooseUnits must exist");
  assert.deepEqual(chooseUnits(units, ["u3", "u1"]).map((u) => u.id), ["u1", "u3"]);
  assert.deepEqual(chooseUnits(units, ["u2"]).map((u) => u.id), ["u2"]);
  assert.deepEqual(chooseUnits(units, []).map((u) => u.id), []);
});

test("chooseUnits with unknown availability returns every unit", () => {
  const { chooseUnits } = window.SHBookCalc;
  assert.deepEqual(chooseUnits(units, null).map((u) => u.id), ["u1", "u2", "u3"]);
  // does not mutate the input list
  assert.equal(units.length, 3);
});
