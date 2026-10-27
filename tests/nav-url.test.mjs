// Focused test: the open screen is kept in the URL (js/app.js goto()).
// Risk covered: a refresh always dropped people back on Overview (or Setup),
// and Back/Forward left the app. Now goto() writes #view, a refresh or
// bookmark reopens it, Back/Forward move between screens, and automatic
// redirects replace the history entry instead of piling up new ones.
// Run: node --test tests/nav-url.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const support = read("js/support.js");

// Run the real VIEWS / viewFromHash / goto / popstate block with a fake page.
const block = app.slice(app.indexOf("const VIEWS = new Set("), app.indexOf('document.addEventListener("click", (e) => {\n  const nav = e.target.closest("[data-view]");'));
function harness(hash = "", role = "owner") {
  const names = ["overview", "setup", "reservations", "calendar", "housekeeping", "maintenance", "support", "settings", "admin"];
  const el = (id) => ({ id, classList: { on: false, toggle(_c, v) { this.on = v; } } });
  const views = names.map((n) => el("view-" + n));
  const entries = [];
  const listeners = {};
  const events = [];
  let scrolls = 0;
  const location = { hash };
  const win = {
    history: {
      pushState: (_s, _t, url) => { entries.push(["push", url]); location.hash = url; },
      replaceState: (_s, _t, url) => { entries.push(["replace", url]); location.hash = url; }
    },
    scrollTo: () => { scrolls++; },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    dispatchEvent: (e) => events.push(e.detail.view)
  };
  const env = {
    $$: (sel) => (sel === ".view" ? views : []),
    ROLE_VIEWS: { cleaner: ["housekeeping", "maintenance"] },
    liveRole: role,
    renderRates() {}, renderRateMgmt() {}, renderSetupUI() {}, loadFontPreviews() {},
    document: { body: { classList: { remove() {} } } },
    location, window: win,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  };
  env.canSee = (v) => !env.ROLE_VIEWS[env.liveRole] || env.ROLE_VIEWS[env.liveRole].includes(v) || v === "admin";
  const fn = new Function(...Object.keys(env), block + "\nreturn { goto, viewFromHash };");
  const api = fn(...Object.values(env));
  const active = () => views.find((v) => v.classList.on)?.id.replace("view-", "");
  return { ...api, entries, location, active, events, popstate: () => listeners.popstate(), scrolls: () => scrolls };
}

test("clicking through screens adds history entries", () => {
  const h = harness();
  h.goto("reservations");
  h.goto("calendar");
  assert.deepEqual(h.entries, [["push", "#reservations"], ["push", "#calendar"]]);
  assert.equal(h.active(), "calendar");
  assert.deepEqual(h.events, ["reservations", "calendar"], "support.js hears every screen change");
});

test("the URL names the screen; anything else is ignored", () => {
  assert.equal(harness("#reservations").viewFromHash(), "reservations");
  for (const hash of ["", "#signup", "#login", "#access_token=x", "#nope"]) assert.equal(harness(hash).viewFromHash(), "", hash);
});

test("Back/Forward shows the screen in the URL without adding entries", () => {
  const h = harness();
  h.goto("reservations");
  h.location.hash = "#overview"; // the browser went back
  h.popstate();
  assert.equal(h.active(), "overview");
  assert.equal(h.entries.length, 1);
});

test("automatic redirects replace the entry and keep the scroll position", () => {
  const h = harness("#reservations");
  h.goto("setup", "replace");
  assert.deepEqual(h.entries, [["replace", "#setup"]]);
  assert.equal(h.scrolls(), 0);
});

test("a screen the role can't see becomes their home screen, and the URL says so", () => {
  const h = harness("#payments", "cleaner");
  h.goto("payments", "none"); // a cleaner refreshing on an owner's bookmark
  assert.equal(h.active(), "housekeeping");
  assert.deepEqual(h.entries, [["replace", "#housekeeping"]]);
});

test("a refresh reopens the URL's screen before and after the data loads", () => {
  assert.match(app, /const v = viewFromHash\(\);\s+if \(v && v !== "admin"\) goto\(v, "none"\);\s+\}\s+loadLiveIntoUI\(\);/);
  assert.match(app, /const wanted = viewFromHash\(\);\s+if \(wanted && wanted !== "admin"\) goto\(wanted, "replace"\);/, "the URL beats the setup redirect");
  assert.match(app, /goto\(ROLE_VIEWS\[liveRole\]\[0\], "replace"\)/);
});

test("support and System Admin load from any route, admin only once confirmed", () => {
  assert.match(support, /window\.addEventListener\("sh-view", \(e\) => \{\s+const view = e\.detail && e\.detail\.view;\s+if \(view === "support"\) loadMyCases\(\);\s+if \(view === "admin"\) loadAdmin\(\);/);
  assert.match(support, /if \(is && location\.hash === "#admin"\) goto\("admin", "replace"\);/);
  assert.doesNotMatch(support, /closest\("\[data-view\]"\)/, "no second click listener");
});
