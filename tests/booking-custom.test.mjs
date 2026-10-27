// Focused test: booking page customization (background/foreground colors,
// color pickers, hero image) flows studio -> tenant columns -> guest page.
// Run: node --test tests/booking-custom.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const bookHtml = readFileSync(new URL("../book.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const book = readFileSync(new URL("../js/book.js", import.meta.url), "utf8");
const bookCss = readFileSync(new URL("../css/book.css", import.meta.url), "utf8");

test("studio offers color pickers for brand, background and foreground", () => {
  for (const id of ["bkBrand", "bkBg", "bkFg"]) {
    assert.match(html, new RegExp(`<input type="color" id="${id}"`), `missing color picker #${id}`);
  }
});

test("studio offers a hero image upload and removal", () => {
  assert.match(html, /<input type="file" id="bkHeroFile" accept="image\/\*"/);
  assert.match(html, /id="bkHeroRemove"/);
  assert.match(app, /uploadPublic\("property-logos", `\$\{SHDB\.tenantId\(\)\}\/hero-/);
  assert.match(app, /updateTenantSettings\(\{ hero_image_url: url \}\)/);
  assert.match(app, /updateTenantSettings\(\{ hero_image_url: null \}\)/);
});

test("publish saves the three colors and hero, live load restores them", () => {
  const pub = app.slice(app.indexOf('a === "publish-page"'), app.indexOf('a === "copy-embed"'));
  assert.match(pub, /brand_color:/);
  assert.match(pub, /booking_bg_color:/);
  assert.match(pub, /booking_fg_color:/);
  assert.match(pub, /hero_image_url:/);
  assert.match(app, /live\.tenant\.booking_bg_color/);
  assert.match(app, /live\.tenant\.booking_fg_color/);
  assert.match(app, /live\.tenant\.hero_image_url/);
});

test("guest page applies tenant colors and hero image", () => {
  const line = book.split("\n").find((l) => l.includes("tenants?slug=") || l.includes("tenantCols"));
  const colsLine = book.split("\n").find((l) => l.includes("const tenantCols"));
  assert.ok(colsLine, "tenantCols not found");
  for (const c of ["booking_bg_color", "booking_fg_color", "hero_image_url"]) {
    assert.ok(colsLine.includes(c), `public tenant select missing ${c}`);
  }
  assert.match(book, /booking_bg_color/);
  assert.match(book, /booking_fg_color/);
  assert.match(book, /hero_image_url/);
  assert.match(book, /has-hero/);
  assert.match(bookHtml, /id="bkHero"/);
  assert.match(bookCss, /\.bk-hero\.has-hero/);
});

test("migration adds the columns and grants only those to anon", () => {
  const path = new URL("../supabase/migrations/20261113000000_booking_customization.sql", import.meta.url);
  assert.ok(existsSync(path), "booking customization migration missing");
  const sql = readFileSync(path, "utf8");
  for (const c of ["booking_bg_color", "booking_fg_color", "hero_image_url"]) {
    assert.match(sql, new RegExp(`add column if not exists ${c} text`));
  }
  assert.match(sql, /grant select \(booking_bg_color, booking_fg_color, hero_image_url\) on public\.tenants to anon/);
  assert.ok(!/ical_token|stripe_customer_id/.test(sql), "migration must not widen secret access");
});
