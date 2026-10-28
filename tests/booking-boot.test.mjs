// Focused test: the booking page opens straight into the property's own page.
// Risks covered: guests seeing the default page first ("Loading…", the
// default green theme, "Find your stay") and then a jump to the property's
// theme, photo and fonts; a slow chain of requests before anything shows;
// and a failed load leaving the page stuck on "Loading…".
// Run: node --test tests/booking-boot.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("book.html");
const css = read("css/book.css");
const book = read("js/book.js");
const themeSrc = read("js/booking-theme.js");
const load = book.slice(book.indexOf("  async function load() {"), book.indexOf("  /* Guests: a −/+ stepper"));

/* Run js/booking-theme.js the way book.html does (data-apply, in <head>). */
function boot({ host = "pocketmacro.simplehotelier.com", search = "?property=pocketmacro", stored = null, storageThrows = false } = {}) {
  const vars = {}, listeners = {}, loaded = [];
  let link = null;
  const store = { ...(stored ? { "sh-booking-themes": JSON.stringify(stored) } : {}) };
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error("blocked"); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error("blocked"); store[k] = String(v); }
  };
  const document = {
    currentScript: { hasAttribute: (a) => a === "data-apply" },
    documentElement: { style: { setProperty: (k, v) => { vars[k] = v; } }, dataset: {} },
    head: { appendChild: (el) => { link = el; } },
    getElementById: () => link,
    createElement: () => ({ href: "", addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } }),
    fonts: { load: (f) => { loaded.push(f); return Promise.resolve([]); } }
  };
  const window = {};
  new Function("window", "document", "localStorage", "location", themeSrc)(window, document, localStorage, { hostname: host, search });
  const fire = (type) => (listeners[type] || []).splice(0).forEach((fn) => fn());
  return { T: window.SHTheme, vars, store, loaded, fire, document };
}

test("the page starts on a quiet loader, everything else hidden", () => {
  assert.match(html, /<body class="booting">\n<div class="bk-boot" role="status"><span class="bk-boot-spin" aria-hidden="true"><\/span>Loading…<\/div>/);
  assert.match(css, /\.bk-boot \{ display: none; \}/);
  assert.match(css, /body\.booting > :not\(\.bk-boot\) \{ visibility: hidden; \}/);
  assert.match(css, /body\.booting \.bk-boot \{[^}]*animation: bk-boot-in \.2s ease \.4s both;/, "a quick load never flashes the loader");
  // The theme script runs in <head>, before anything draws.
  assert.ok(html.indexOf('<script src="js/booking-theme.js" data-apply></script>') < html.indexOf("<body"));
});

test("a return visit paints in the property's own theme straight away", () => {
  const first = boot();
  assert.equal(first.vars["--bg"], "#f3f4ef", "first visit: the default theme");
  const dark = { preset: "evening", colors: { bg: "#0e0e10" } };
  first.T.rememberTheme(dark);
  const saved = JSON.parse(first.store["sh-booking-themes"]);
  assert.deepEqual(Object.keys(saved), ["pocketmacro.simplehotelier.com|pocketmacro"]);

  const again = boot({ stored: saved });
  assert.equal(again.vars["--bg"], "#0e0e10");
  assert.equal(again.document.documentElement.dataset.theme, "evening");
  // Another property's page keeps its own (here: none yet).
  assert.equal(boot({ stored: saved, search: "?property=pinecrest" }).vars["--bg"], "#f3f4ef");
  assert.equal(boot({ stored: saved, host: "other.simplehotelier.com" }).vars["--bg"], "#f3f4ef");
});

test("remembered themes stay small, and stored junk is still made safe", () => {
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`h${i}|p`, {}]));
  const b = boot({ stored: many });
  b.T.rememberTheme({ preset: "pine" });
  const keys = Object.keys(JSON.parse(b.store["sh-booking-themes"]));
  assert.equal(keys.length, 20);
  assert.equal(keys.at(-1), "pocketmacro.simplehotelier.com|pocketmacro", "most recent kept");
  const junk = boot({ stored: { "pocketmacro.simplehotelier.com|pocketmacro": { colors: { bg: "red;}body{display:none" }, headingFont: "x" } } });
  assert.equal(junk.vars["--bg"], "#f3f4ef");
  // Storage blocked (private mode, embedded with storage off): default theme, no errors.
  const off = boot({ storageThrows: true });
  assert.equal(off.vars["--bg"], "#f3f4ef");
  assert.doesNotThrow(() => off.T.rememberTheme({ preset: "pine" }));
});

test("fontsReady waits for the theme's stylesheet, then its faces", async () => {
  const b = boot();
  b.T.apply({ preset: "evening" });
  let ready = false;
  const p = b.T.fontsReady().then(() => { ready = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ready, false, "stylesheet still loading");
  b.fire("load");
  await p;
  assert.deepEqual(b.loaded.slice(-3), ['600 1em "Cormorant Garamond"', '400 1em "Inter"', '600 1em "Inter"']);
  // A stylesheet that fails to load never holds the page.
  const c = boot();
  c.T.apply({ preset: "pine" });
  const q = c.T.fontsReady();
  c.fire("error");
  await q;
});

test("after the property, everything else loads in one round", () => {
  const awaits = load.match(/\bawait\b/g) || [];
  assert.equal(awaits.length, 3, "property, then one Promise.all, then the capped wait");
  const round = load.slice(load.indexOf("await Promise.all(["), load.indexOf("]);", load.indexOf("await Promise.all([")));
  for (const part of ['api("rooms?', 'api("addons?', 'api("tax_rules?', 'api("room_types?', 'api("room_rate_overrides?', "fetchRatePlans()"]) {
    assert.ok(round.includes(part), part + " in the same round");
  }
  assert.doesNotMatch(load, /await loadRatePlans\(\)/);
  assert.match(load, /applyRatePlans\(planRows\);/);
});

test("every way out of loading shows the page", () => {
  const exits = [...load.matchAll(/showError\("[^"]+"\);\s*endBoot\(\);/g)];
  assert.equal(exits.length, 3, "not configured, property not found, load failed");
  const ok = load.slice(load.indexOf("renderRooms(); renderAddons(); renderSummary();"), load.indexOf("} catch (e) {"));
  assert.match(ok, /await Promise\.race\(\[Promise\.all\(\[assets, avail\]\), new Promise\(\(done\) => setTimeout\(done, 1200\)\)\]\);\s+endBoot\(\);/,
    "photo, fonts and linked availability get a moment, never more than 1.2s");
  assert.ok(load.indexOf("SHTheme.rememberTheme(t.booking_theme)") > load.indexOf("SHTheme.apply(t.booking_theme)"));
  assert.ok(load.indexOf("const assets = pageAssets()") < load.indexOf("await Promise.all(["), "the photo loads alongside the data");
  assert.match(book, /function endBoot\(\) \{\s+document\.body\.classList\.remove\("booting"\);\s+postHeight\(\);/);
});
