// Focused test: the dashboard's date and time pickers (js/pickers.js), and
// saves that answer with an empty body. Risks covered: a typed time saved in
// a shape the booking page can't show, a month grid that starts on the
// wrong day, dates a day off, the picker breaking code that reads or sets
// the input's value, check-out allowed on or before check-in, a time field
// that isn't wired, and a successful rate save reported as failed.
// Run: node --test tests/pickers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.TZ = "America/Los_Angeles";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const src = read("js/pickers.js");
const html = read("app.html");
const app = read("js/app.js");
const rxjs = read("js/reservation.js");
const db = read("js/db.js");
const P = (() => { const window = {}; new Function("window", src)(window); return window.SHPickers; })();

test("times: typed the way people type them, saved as h:mm AM/PM", () => {
  const cases = { "3:00 PM": "3:00 PM", "3pm": "3:00 PM", "3 pm": "3:00 PM", "3:15 p": "3:15 PM", "11am": "11:00 AM", "11:30 a.m.": "11:30 AM",
    "15:45": "3:45 PM", "1545": "3:45 PM", "0930": "9:30 AM", "12pm": "12:00 PM", "12am": "12:00 AM", "noon": "12:00 PM", "midnight": "12:00 AM", "0:05": "12:05 AM" };
  for (const [typed, want] of Object.entries(cases)) assert.equal(P.fmtTime(P.parseTime(typed)), want, typed);
  for (const bad of ["", "13pm", "3:75", "25:00", "after 3", "0am"]) assert.equal(P.parseTime(bad), null, bad);
  assert.equal(P.timeList(30).length, 48);
  assert.equal(P.fmtTime(P.timeList(15)[95]), "11:45 PM");
});

test("calendar: six weeks from the Sunday on or before the 1st, on midnight through daylight saving", () => {
  const nov = P.monthGrid(2026, 10); // November 2026 starts on a Sunday; clocks change Nov 1
  assert.equal(nov.length, 42);
  assert.equal(nov[0].toDateString(), "Sun Nov 01 2026");
  assert.ok(nov.every((d) => d.getHours() === 0), "every day at midnight");
  assert.deepEqual(nov.slice(0, 3).map((d) => d.getDate()), [1, 2, 3]);
  const oct = P.monthGrid(2026, 9); // Oct 1, 2026 is a Thursday
  assert.equal(oct[0].toDateString(), "Sun Sep 27 2026");
  assert.equal(oct[4].toDateString(), "Thu Oct 01 2026");
  assert.equal(P.fmtDate("2026-10-28"), "Wed, Oct 28, 2026");
  assert.equal(P.parseIso("2026-02-30"), null, "no Feb 30");
});

test("the picker keeps the input: code reading, setting and listening still works", () => {
  // A stand-in for the browser's input and button elements.
  const classes = () => { const set = new Set(); return { add: (c) => set.add(c), contains: (c) => set.has(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)) }; };
  class Node {
    constructor() { this.attrs = {}; this.dataset = {}; this.classList = classes(); this.isConnected = true; }
    get className() { return this._cn || ""; }
    set className(v) { this._cn = v; v.split(" ").forEach((c) => this.classList.add(c)); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    hasAttribute(k) { return k in this.attrs; }
    after(n) { this.nextElementSibling = n; n.previousElementSibling = this; }
    addEventListener(type, fn) { (this.on ||= {})[type] = fn; }
    matches() { return false; }
    querySelectorAll() { return []; }
  }
  class Input extends Node {}
  Object.defineProperty(Input.prototype, "value", { configurable: true, get() { return this._v || ""; }, set(v) { this._v = String(v); } });
  const document = { createElement: () => new Node(), querySelector: () => null, addEventListener() {}, body: null };
  const window = {};
  new Function("window", "document", "HTMLInputElement", "CSS", "MutationObserver", "addEventListener", src)(
    window, document, Input, { escape: (x) => x }, class { observe() {} }, () => {});
  const input = new Input();
  Object.assign(input, { type: "date", id: "rx-checkIn", disabled: false });
  input.value = "2026-10-28";
  window.SHPickers.enhanceAll({ querySelectorAll: () => [input] });
  const field = input.nextElementSibling;
  assert.equal(field.type, "button");
  assert.ok(field.className.includes("pk-field"));
  assert.match(field.innerHTML, /Wed, Oct 28, 2026/);
  assert.equal(input.tabIndex, -1, "the hidden input is out of the tab order");
  assert.ok(input.classList.contains("pk-native"));
  input.value = "2026-11-04"; // code setting the value repaints the field
  assert.match(field.innerHTML, /Wed, Nov 4, 2026/);
  assert.equal(input.value, "2026-11-04", "and still reads back as YYYY-MM-DD");
  assert.equal(typeof input.on.focus, "function", "a label click (focus) opens the picker");
  // A time field shows the stored text, tidied when it's a time.
  const t = new Input();
  Object.assign(t, { type: "text", id: "pfCheckIn", disabled: false });
  t.dataset.picker = "time";
  t.value = "3pm";
  window.SHPickers.enhanceAll({ querySelectorAll: () => [t] });
  assert.match(t.nextElementSibling.innerHTML, /3:00 PM/);
});

test("wired: every dashboard date and both property times, check-out after check-in", () => {
  assert.match(html, /<script src="js\/reports\.js"><\/script>\n<script src="js\/pickers\.js"><\/script>/);
  assert.match(html, /id="pfCheckIn" data-picker="time"/);
  assert.match(html, /id="pfCheckOut" data-picker="time"/);
  assert.match(html, /id="repFrom"[^>]*data-pk-end="repTo"/);
  assert.match(html, /id="repTo"[^>]*data-pk-start="repFrom"/);
  assert.match(app, /<label for="buFrom">From<\/label><input class="input" id="buFrom" type="date" value="\$\{todayIso\}" data-pk-end="buTo">/);
  assert.match(rxjs, /id="rx-checkIn" data-rx-field="checkIn" data-pk-end="rx-checkOut"/);
  assert.match(rxjs, /id="rx-checkOut" data-rx-field="checkOut" data-pk-start="rx-checkIn" data-pk-gap="1"/, "check-out is at least a night later");
  assert.match(src, /if \(cur && cur\.startDate && input\.dataset\.pkGap && d < addDays\(cur\.startDate, \+input\.dataset\.pkGap\)\) return false;/);
  assert.match(src, /input\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\);\s+input\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\);/);
});

test("a save answered with an empty body succeeded (bulk rate updates)", async () => {
  const restSrc = db.match(/  async function rest\(path, opts = \{\}\) \{[\s\S]*?\n  \}\n/)[0];
  const make = (status, body) => new Function("cfg", "freshToken", "fetch", restSrc + "\nreturn rest;")(
    { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" }, async () => "t",
    async () => ({ ok: status < 300, status, text: async () => body, json: async () => JSON.parse(body) }));
  assert.equal(await make(201, "")("room_rate_overrides", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }), null, "201 Created, return=minimal");
  assert.equal(await make(204, "")("x", { method: "PATCH" }), null);
  assert.deepEqual(await make(201, '[{"id":1}]')("rooms", { method: "POST" }), [{ id: 1 }]);
  await assert.rejects(make(403, '{"message":"denied"}')("x"), (e) => e.status === 403 && e.code === "denied");
  assert.match(db, /headers: \{ Prefer: "resolution=merge-duplicates,return=minimal" \}/, "the bulk update still asks for no body");
});
