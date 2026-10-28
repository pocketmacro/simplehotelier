// Focused test: paired fields in the dashboard (Postcode / City, Check-in /
// Check-out, ...) stay inside their column. Risk covered: plain 1fr columns
// can't shrink below a text box's default width (about 20 characters), so in
// a narrow column the second box hung over into the next column.
// Run: node --test tests/form-columns.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");

test("form rows use columns that can shrink", () => {
  assert.match(css, /\.form-2 \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.form-3 \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.form-2 \.input, \.form-2 \.select, \.form-3 \.input, \.form-3 \.select \{ min-width: 0; max-width: 100%; \}/);
  assert.match(css, /\.form-2, \.form-3 \{ grid-template-columns: minmax\(0, 1fr\); \}/, "phones: one column, same rule");
  assert.doesNotMatch(css, /\.form-[23][^{]*\{[^}]*grid-template-columns: 1fr/, "no plain 1fr form columns left");
});
