// Focused test: hero focus point in the Booking Page studio.
// Owner clicks/drags on the hero to choose the focal point; the studio
// preview moves the image's background-position immediately, the choice
// is saved with Publish changes, and the guest page renders the hero
// with that background-position.
// Run: node --test tests/booking-hero-focus.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const book = readFileSync(new URL("../js/book.js", import.meta.url), "utf8");

test("studio has a clickable focus picker over the hero image", () => {
  assert.match(html, /id="bkHeroFocus"/);
  assert.match(html, /id="bkHeroFocusDot"/);
  assert.match(app, /bkHeroFocus/);
  assert.match(app, /addEventListener\("pointerdown"/);
  assert.match(app, /addEventListener\("pointermove"/);
});

test("preview positions the hero from the focus point", () => {
  assert.match(app, /let studioHeroFocus = \{ x: 50, y: 50 \}/);
  const preview = app.slice(app.indexOf("function applyStudioPreview()"), app.indexOf("function bindStudio()"));
  assert.match(preview, /studioHeroFocus\.x/);
  assert.match(preview, /studioHeroFocus\.y/);
  assert.match(preview, /\/ cover/);
});

test("focus is saved on Publish and restored on live load (not before)", () => {
  const pub = app.slice(app.indexOf('a === "publish-page"'), app.indexOf('a === "copy-embed"'));
  assert.match(pub, /hero_focus_x: Math\.round\(studioHeroFocus\.x\)/);
  assert.match(pub, /hero_focus_y: Math\.round\(studioHeroFocus\.y\)/);
  assert.match(app, /live\.tenant\.hero_focus_x/);
  assert.match(app, /live\.tenant\.hero_focus_y/);
});

test("guest page requests and applies the saved focus", () => {
  const colsLine = book.split("\n").find((l) => l.includes("const tenantCols"));
  assert.ok(colsLine.includes("hero_focus_x") && colsLine.includes("hero_focus_y"));
  assert.match(book, /hero_focus_x/);
  assert.match(book, /backgroundPosition/);
});

test("migration stores focus as percent columns granted to anon", () => {
  const path = new URL("../supabase/migrations/20261114000000_hero_focus.sql", import.meta.url);
  assert.ok(existsSync(path), "hero focus migration missing");
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /add column if not exists hero_focus_x/);
  assert.match(sql, /add column if not exists hero_focus_y/);
  assert.match(sql, /grant select \(hero_focus_x, hero_focus_y\) on public\.tenants to anon/);
});
