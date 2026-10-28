// Focused test: booking-page text inside cards stays readable on a dark
// page. Risk covered: a card part painted with the page background
// (var(--bg)) while its text uses the card's ink, which on a dark page with
// light cards is dark on dark (the confirmation number was invisible).
// Run: node --test tests/booking-contrast.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/book.css", import.meta.url), "utf8");

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, pa, b) => a.map((v, i) => v * pa + b[i] * (1 - pa)); // color-mix(in srgb, a pa%, b)
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("only the page itself uses the page background", () => {
  const uses = css.split("\n").filter((l) => l.includes("var(--bg)")).map((l) => l.trim().split("{")[0].trim());
  assert.deepEqual(uses, ["body", "body.embed"]);
});

test("the confirmation number reads clearly on a dark page with light cards", () => {
  const rule = css.match(/\.bk-conf \{([^}]*)\}/)[1];
  assert.match(rule, /color: var\(--ink\); background: color-mix\(in srgb, var\(--ink\) 6%, var\(--surface\)\)/);
  // Sam's Chicken Ranch: near-black page, cream cards with near-black text.
  const page = rgb("#0e0e10"), surface = rgb("#f4f2eb"), cardInk = rgb("#0e0e10");
  assert.ok(contrast(cardInk, page) < 1.1, "what it was: dark on dark");
  assert.ok(contrast(cardInk, mix(cardInk, 0.06, surface)) >= 7, "now: dark on a light tint of the card");
  // And a light page with dark cards (light card text).
  const darkCard = rgb("#1c2620"), lightInk = rgb("#f4f2eb");
  assert.ok(contrast(lightInk, mix(lightInk, 0.06, darkCard)) >= 7);
});
