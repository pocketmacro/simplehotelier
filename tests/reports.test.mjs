// Focused test: the Reports screen's numbers. Risks covered: tax counted on
// tax (percent rules applied to tax-inclusive totals), a long stay counted
// only on its check-in day (or missing from a period it overlaps), requests
// and cancellations counted as revenue, Airbnb/Vrbo blocks inflating the
// average rate, a period switch that changes nothing, and an export that
// doesn't say which dates it covers.
// Run: node --test tests/reports.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const html = read("app.html");
const db = read("js/db.js");
const src = app.slice(app.indexOf("/* ---------------- Reports (computed"), app.indexOf("function renderReports()"));

const BASE = new Date(2026, 9, 28); // Oct 28, 2026
const addDays = (n) => { const d = new Date(BASE); d.setDate(d.getDate() + n); return d; };
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dstr = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
function reports(reservations, { rooms = [{ code: "A1", name: "Aspen" }, { code: "A2", name: "Birch" }], taxes = [] } = {}) {
  return new Function("reservations", "rooms", "taxes", "balance", "addDays", "isoLocal", "dstr", "roomByCode",
    src + "\nreturn { computeReports, stayMoney, taxSplit, reportLabel };")(
    reservations, rooms, taxes, (r) => Math.max(0, r.total - r.paid), addDays, isoLocal, dstr, (c) => rooms.find((r) => r.code === c));
}
const stay = (o) => ({ room: "A1", status: "confirmed", total: 0, paid: 0, tax: 0, source: "direct", ...o });

test("revenue is before tax and lands on the nights stayed", () => {
  // 6 nights (offsets -9..-4), $600 with $60 tax: $90 a night before tax.
  const R = reports([stay({ inN: -9, outN: -3, total: 600, tax: 60, paid: 600, status: "checked-out" })]);
  const week = R.computeReports({ days: 7, ahead: false }); // nights -6..0
  assert.equal(week.revenue, 270, "the 3 nights inside the week");
  assert.equal(week.nightsSold, 3);
  assert.equal(week.buckets.length, 7);
  assert.deepEqual(week.buckets.slice(0, 4).map((b) => b.value), [90, 90, 90, 0]);
  assert.equal(week.buckets[0].iso, "2026-10-22");
  assert.equal(week.taxTotal, 30);
  const month = R.computeReports({ days: 30, ahead: false });
  assert.equal(month.revenue, 540, "the whole stay");
  assert.equal(R.computeReports({ days: 30, ahead: true }).count, 0, "nothing ahead");
});

test("firm bookings only; requests are counted apart; the period switch matters", () => {
  const R = reports([
    stay({ inN: -2, outN: 1, total: 330, tax: 30 }),                      // confirmed, tonight included
    stay({ room: "A2", inN: -1, outN: 2, total: 200, status: "pending" }),
    stay({ room: "A2", inN: -5, outN: -3, total: 200, status: "cancelled" }),
    stay({ room: "A2", inN: 3, outN: 5, total: 220, tax: 20, status: "confirmed" })
  ]);
  const last = R.computeReports({ days: 7, ahead: false });
  assert.equal(last.count, 1);
  assert.equal(last.requests, 1);
  assert.equal(last.revenue, 300);
  const next = R.computeReports({ days: 30, ahead: true });
  assert.equal(next.count, 1, "tonight belongs to the past period; the stay from night 3 is ahead");
  assert.equal(next.revenue, 200);
  assert.equal(next.start.getDate(), 29);
  assert.equal(R.reportLabel({ days: 30, ahead: true }), "Next 30 days");
});

test("occupancy, average nightly rate and Airbnb/Vrbo blocks", () => {
  const R = reports([
    stay({ inN: -6, outN: -2, total: 440, tax: 40, paid: 100 }),              // 4 nights, $100 a night
    stay({ room: "A2", inN: -3, outN: 1, total: 0, source: "airbnb", icalFeedId: "f1" }) // 4 nights, no money
  ]);
  const r = R.computeReports({ days: 7, ahead: false });
  assert.equal(r.roomNights, 14);
  assert.equal(r.nightsSold, 8);
  assert.equal(Math.round(r.occupancy * 100), 57);
  assert.equal(r.adr, 100, "blocks fill nights but don't drag the rate down");
  assert.equal(r.due, 340);
  assert.equal(r.dueCount, 1);
  assert.deepEqual(r.sources.map((s) => [s.key, s.count, s.revenue]), [["direct", 1, 400], ["airbnb", 1, 0]]);
  assert.deepEqual(r.units.map((u) => [u.code, u.nights, u.revenue]), [["A1", 4, 400], ["A2", 4, 0]]);
});

test("tax splits by rule the way pricing works it out, and tracks what guests paid", () => {
  const taxes = [
    { name: "Lodging", kind: "percent", value: 10, applies: "Room only", on: true },
    { name: "Sales", kind: "percent", value: 5, applies: "Room + add-ons", on: true },
    { name: "Tourism", kind: "night", value: 2, applies: "Per night", on: true },
    { name: "Old fee", kind: "percent", value: 9, on: false }
  ];
  // 4 nights: room $400, add-ons $100 → 40 + 25 + 8 = $73 tax.
  const b = stay({ inN: -3, outN: 1, subtotal: 400, discount: 0, extras: 100, extraPerson: 0, tax: 73, total: 573, paid: 286.5 });
  const R = reports([b], { taxes });
  assert.deepEqual(R.taxSplit(b, R.stayMoney(b)).map(([n, v]) => [n, Math.round(v * 100) / 100]), [["Lodging", 40], ["Sales", 25], ["Tourism", 8]]);
  const r = R.computeReports({ days: 30, ahead: false });
  assert.deepEqual(r.taxRows, [{ name: "Lodging", charged: 40, paid: 20 }, { name: "Sales", charged: 25, paid: 12.5 }, { name: "Tourism", charged: 8, paid: 4 }]);
  assert.equal(r.taxTotal, 73);
  assert.equal(r.taxPaid, 36.5);
  assert.equal(r.revenue, 500, "revenue excludes the tax");
  // Rules changed since: the split follows them, the total stays what was charged.
  const R2 = reports([b], { taxes: [taxes[0]] });
  assert.deepEqual(R2.computeReports({ days: 30, ahead: false }).taxRows, [{ name: "Lodging", charged: 73, paid: 36.5 }]);
});

test("demo bookings without stored tax back it out of the total", () => {
  const taxes = [{ name: "Lodging", kind: "percent", value: 10, on: true }, { name: "Flat", kind: "night", value: 5, on: true }];
  const R = reports([], { taxes });
  const m = R.stayMoney({ inN: 0, outN: 2, total: 230 }); // (230 - 10) / 1.1 = 200
  assert.equal(Math.round(m.net * 100) / 100, 200);
  assert.equal(Math.round(m.tax * 100) / 100, 30);
});

test("Season is weekly and adds up; unknown sources are Other", () => {
  const R = reports([
    stay({ inN: -80, outN: -70, total: 1000, source: "expedia" }),
    stay({ room: "A2", inN: -20, outN: -15, total: 500, source: "" })
  ]);
  const r = R.computeReports({ days: 90, ahead: false });
  assert.equal(r.weekly, true);
  assert.equal(r.buckets.length, 13);
  assert.equal(Math.round(r.buckets.reduce((s, b) => s + b.value, 0)), 1500);
  assert.deepEqual(r.sources.map((s) => s.key), ["direct", "other"]);
});

test("dates stay on midnight across daylight saving (every booking date and chart label)", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const line = app.match(/const addDays = \(n\) => \{[^\n]*\};/)[0];
    const TODAY = new Date(2026, 9, 28);
    const add = new Function("TODAY", line + "\nreturn addDays;")(TODAY);
    for (let n = 0; n <= 400; n++) {
      const d = add(n);
      assert.equal(d.getHours(), 0, `day ${n}`);
      assert.equal(Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 9, 28)) / 864e5), n);
    }
    assert.equal(add(7).toDateString(), "Wed Nov 04 2026", "Nov 1 change: no longer shows Nov 3");
  } finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
});

test("the screen, the switch, refreshes and the export are wired", () => {
  assert.match(html, /<button type="button" data-days="30" data-ahead="1">Next 30 days<\/button>/);
  for (const id of ["repRev", "repOcc", "repAdr", "repDue", "revChart", "channelCard", "topRooms", "taxLiability"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(app, /reportPeriod = \{ days: parseInt\(b\.dataset\.days, 10\) \|\| 30, ahead: b\.dataset\.ahead === "1" \};/);
  assert.match(app, /if \(view === "reports"\) renderReports\(\);/, "opening Reports redraws it");
  assert.match(app, /renderFolios\(\); renderReports\(\);\n\}/, "booking changes redraw it");
  assert.match(app, /\["From", isoLocal\(rep\.start\)\], \["To", isoLocal\(rep\.end\)\], \["Currency", moneyCurrency\]/, "the export says which dates");
  assert.match(db, /tax: \(r\.tax_cents \|\| 0\) \/ 100, subtotal: \(r\.subtotal_cents \|\| 0\) \/ 100/);
});
