// Focused test: booking page customization — themes (fonts, colors,
// corners, wording) flow studio -> tenants.booking_theme -> guest page, and a
// stored theme can never inject CSS or load arbitrary stylesheets.
// Run: node --test tests/booking-custom.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("app.html");
const bookHtml = read("book.html");
const app = read("js/app.js");
const book = read("js/book.js");
const bookCss = read("css/book.css");

// Load the shared theme module the way both pages do (classic script).
const styles = {};
globalThis.window = {};
globalThis.document = {
  documentElement: { style: { setProperty: (k, v) => { styles[k] = v; } }, dataset: {} },
  head: { appendChild: (el) => { globalThis.__fontLink = el; } },
  getElementById: () => globalThis.__fontLink || null,
  createElement: () => ({})
};
eval(read("js/booking-theme.js"));
const T = window.SHTheme;

test("studio offers themes, fonts, six colors, corners, unit name, eyebrow", () => {
  for (const id of ["bkPresets", "bkHeadFont", "bkBodyFont", "bkColorGrid", "bkRadius", "bkUnit", "bkEyebrow", "bkNumbered", "bkPreview", "bkDevice"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.equal(T.COLOR_KEYS.length, 6);
  assert.ok(Object.keys(T.PRESETS).length >= 6);
  assert.ok(html.indexOf("js/booking-theme.js") < html.indexOf("js/app.js"), "theme module loads before app.js");
  assert.ok(bookHtml.indexOf("js/booking-theme.js") < bookHtml.indexOf("js/book.js"));
});

test("studio offers a hero image upload and removal", () => {
  assert.match(html, /<input type="file" id="bkHeroFile" accept="image\/\*"/);
  assert.match(html, /id="bkHeroRemove"/);
  assert.match(app, /uploadPublic\("property-logos", `\$\{SHDB\.tenantId\(\)\}\/hero-/);
  assert.match(app, /updateTenantSettings\(\{ hero_image_url: url \}\)/);
  assert.match(app, /updateTenantSettings\(\{ hero_image_url: null \}\)/);
});

test("publish saves the theme; live load restores it", () => {
  const pub = app.slice(app.indexOf('a === "publish-page"'), app.indexOf('a === "copy-embed"'));
  assert.match(pub, /booking_theme: studioTheme/);
  assert.match(pub, /brand_color: studioTheme\.colors\.brand/);
  assert.match(pub, /hero_image_url:/);
  assert.match(app, /studioTheme = SHTheme\.normalize\(live\.tenant\.booking_theme\)/);
});

test("guest page reads booking_theme and applies it", () => {
  const colsLine = book.split("\n").find((l) => l.includes("const tenantCols"));
  assert.ok(colsLine && colsLine.includes("booking_theme") && colsLine.includes("hero_image_url"));
  assert.match(book, /state\.theme = SHTheme\.apply\(t\.booking_theme\)/);
  assert.match(bookHtml, /id="bkHero"/);
  for (const v of ["--font-head", "--font-body", "--brand", "--r-panel"]) assert.ok(bookCss.includes(`var(${v})`), v);
});

test("preview messages are accepted only from the dashboard's own origin", () => {
  assert.match(book, /if \(e\.origin !== location\.origin \|\| !e\.data \|\| e\.data\.type !== "simplehotelier:preview"/);
  assert.match(book, /if \(isPreview\) \{ showError\("This is a preview/);
  assert.match(app, /postMessage\(\{\s*type: "simplehotelier:preview"[\s\S]*?\}, location\.origin\)/);
});

test("normalize: unknown fonts, bad colors and junk fall back safely", () => {
  const t = T.normalize({
    preset: "nope", headingFont: "Comic Sans'; } body { display:none", bodyFont: "playfair",
    colors: { bg: "red", ink: "#12345", brand: "#ABCDEF", accent: "url(javascript:x)" },
    radius: "blob", eyebrow: "Lake\nside " + "x".repeat(100), unitNoun: "castle"
  });
  assert.equal(t.preset, "meadow");
  assert.equal(t.headingFont, "instrument-serif", "unknown font -> preset font");
  assert.equal(t.bodyFont, "inter", "heading-only face is not allowed as body font");
  assert.equal(t.colors.bg, T.PRESETS.meadow.colors.bg);
  assert.equal(t.colors.ink, T.PRESETS.meadow.colors.ink);
  assert.equal(t.colors.brand, "#abcdef");
  assert.equal(t.colors.accent, T.PRESETS.meadow.colors.accent);
  assert.equal(t.radius, "soft");
  assert.ok(!/[\n\r]/.test(t.eyebrow) && t.eyebrow.length <= 60);
  assert.equal(t.unitNoun, "");
});

test("apply: only allowlisted fonts load, text on buttons stays readable", () => {
  const t = T.apply({ headingFont: "playfair", bodyFont: "dm-sans", colors: { brand: "#d4a85a" } });
  assert.equal(t.headingFont, "playfair");
  assert.match(globalThis.__fontLink.href, /^https:\/\/fonts\.googleapis\.com\/css2\?family=Playfair\+Display:wght@500;600;700&family=DM\+Sans:wght@400;500;600;700&display=swap$/);
  assert.equal(styles["--brand-ink"], "#111111", "dark text on a light gold button");
  assert.equal(T.onColor("#1f5f7a"), "#ffffff");
  assert.ok(T.contrast("#1c2620", "#f3f4ef") >= 4.5, "Meadow text passes AA");
  for (const p of Object.values(T.PRESETS)) {
    assert.ok(T.contrast(p.colors.ink, p.colors.bg) >= 4.5, `${p.label}: text contrast`);
    assert.ok(T.contrast(p.colors.ink, p.colors.surface) >= 4.5, `${p.label}: card text contrast`);
  }
});

test("unit words: owner's choice, custom words, a guess from names, else a neutral word", () => {
  const words = (theme, names) => T.unitWords(T.normalize(theme), names);
  assert.deepEqual(words({}, "Luxury Cabin Tiny Home"), { one: "cabin", many: "cabins" });
  assert.deepEqual(words({}, "Yurt A · Yurt B"), { one: "yurt", many: "yurts" });
  assert.deepEqual(words({}, "Pull-through RV hookup 1"), { one: "RV site", many: "RV sites" });
  assert.deepEqual(words({}, "King Deluxe"), { one: "room", many: "rooms" });
  assert.deepEqual(words({}, "Bluebird · Wren"), { one: "stay", many: "stays" }, "no recognizable word -> neutral");
  assert.deepEqual(words({ unitNoun: "house" }, "Luxury Cabin"), { one: "house", many: "houses" }, "owner's pick beats the guess");
  assert.deepEqual(words({ unitNoun: "custom", unitOne: "lake house" }), { one: "lake house", many: "lake houses" });
  assert.deepEqual(words({ unitNoun: "custom", unitOne: "geodome", unitMany: "geodomes" }), { one: "geodome", many: "geodomes" });
  const bad = T.normalize({ unitNoun: "custom", unitOne: "<img src=x onerror=1>" });
  assert.equal(bad.unitNoun, "", "custom words are letters/numbers/spaces only");
  assert.equal(T.withArticle("cabin"), "a cabin");
  assert.equal(T.withArticle("RV site"), "an RV site");
  assert.equal(T.withArticle("apartment"), "an apartment");
  assert.equal(T.withArticle("unit"), "a unit");
  assert.equal(T.withArticle("yurt"), "a yurt");
  assert.equal(T.withArticle("igloo"), "an igloo");
});

test("migration keeps the theme small, an object, and anon-readable", () => {
  const path = new URL("../supabase/migrations/20261118000000_booking_theme.sql", import.meta.url);
  assert.ok(existsSync(path));
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /add column if not exists booking_theme jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /jsonb_typeof\(booking_theme\) = 'object' and pg_column_size\(booking_theme\) < 4096/);
  assert.match(sql, /grant select \(booking_theme\) on public\.tenants to anon/);
  assert.ok(!/ical_token|stripe_customer_id/.test(sql), "migration must not widen secret access");
});
