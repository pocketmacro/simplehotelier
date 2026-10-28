// Focused test: opening the dashboard on a real account never flashes the
// sample property. Risk covered: app.js drew the built-in demo data (and the
// page's placeholder names) first, then swapped in the live property a
// moment later; or a failed load leaving the screen stuck on "Loading".
// Run: node --test tests/boot-no-flash.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("app.html");
const css = read("css/app.css");
const app = read("js/app.js");
const fn = app.slice(app.indexOf("function loadLiveIntoUI() {"), app.indexOf("/* Refresh / bookmark:"));

test("the page starts in its loading state, data areas hidden", () => {
  assert.match(html, /<body class="booting">/);
  assert.match(html, /<main class="content">\s+<div class="boot-loader" role="status">/);
  assert.match(css, /body\.booting \.content > \.view, body\.booting \.prop-text, body\.booting \.user-chip, body\.booting \.onboard-mini \{ visibility: hidden; \}/);
  assert.match(css, /\.boot-loader \{ display: none; \}/);
});

test("a real account starts with no sample data", () => {
  const boot = app.slice(app.indexOf("/* ---------------- Boot ---------------- */"));
  const clear = boot.indexOf("if (!demoMode() && window.SHDB && SHDB.configured()) clearAllData();");
  assert.ok(clear > 0 && clear < boot.indexOf("renderToday();"), "cleared before the first render");
});

test("every way out of loading ends the loading state", () => {
  const demo = fn.slice(fn.indexOf("if (demoMode()) {"), fn.indexOf("if (!window.SHDB"));
  const local = fn.slice(fn.indexOf("if (!window.SHDB"), fn.indexOf("SHDB.loadLiveData()"));
  const failed = fn.slice(fn.indexOf("if (!live) {"), fn.indexOf("if (!live.tenant) {"));
  const noTenant = fn.slice(fn.indexOf("if (!live.tenant) {"), fn.indexOf("// Real account: replace wholesale"));
  const loaded = fn.slice(fn.indexOf("// Real account: replace wholesale"), fn.indexOf("}).catch("));
  const crashed = fn.slice(fn.indexOf("}).catch("));
  for (const [name, part] of Object.entries({ demo, local, failed, noTenant, loaded, crashed })) {
    assert.match(part, /endBoot\(\);/, name);
  }
  assert.ok(loaded.lastIndexOf("endBoot();") > loaded.indexOf("goto(\"setup\", \"replace\")"), "after routing to the first screen");
  assert.match(fn, /document\.body\.classList\.add\("booting"\);[^\n]*\n\s+SHDB\.loadLiveData\(\)/, "signing in shows the loading state too");
  assert.match(crashed, /SHReportError\(e, "dashboard load"\)/);
  // With no property to show, the page's sample names are cleared too.
  assert.match(failed, /clearSamplePlaceholders\(null\);\s+renderAll\(\);/);
  assert.match(noTenant, /clearSamplePlaceholders\(live\.user\);\s+renderAll\(\);/);
});

test("clearing the sample names leaves no Pinecrest or Maya behind", () => {
  const src = app.match(/function clearSamplePlaceholders\(user\) \{[\s\S]*?\n\}/)[0];
  const els = {
    "#propNameSide": { textContent: "Pinecrest Cabins" }, "#propSubSide": { textContent: "8 units · Estes Park, CO" },
    "#userName": { textContent: "Maya Keller" }, "#userRole": { textContent: "Owner · Pinecrest" }, "#userAvatar": { textContent: "MK" },
    "#pfName": { value: "Pinecrest Cabins" }, "#bkName": { value: "Pinecrest Cabins" }, "#bkUrl": { value: "pinecrest.simplehotelier.com" }
  };
  new Function("$", src + "\nclearSamplePlaceholders({ email: 'new@example.test' });")((id) => els[id]);
  assert.doesNotMatch(JSON.stringify(els), /Pinecrest|Maya|Estes|pinecrest/);
  assert.equal(els["#userName"].textContent, "new@example.test");
  assert.equal(els["#propNameSide"].textContent, "No property yet");
});
