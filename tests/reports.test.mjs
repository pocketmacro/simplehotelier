// Focused test: the Reports pages' numbers (js/reports.js). Risks covered:
// tax counted on tax, a long stay counted only on its check-in day,
// requests and cancellations counted as revenue, Airbnb/Vrbo blocks dragging
// the average rate down, closed nights counted as unsold, occupancy and
// RevPAR that don't agree with each other, the same guest split in two,
// extras or tax lines that don't add up to what was charged, QuickBooks
// files in a shape it can't import, and dates a day off after daylight saving.
// Run: node --test tests/reports.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A US time zone with a daylight-saving change (Nov 1, 2026) inside the dates used.
process.env.TZ = "America/Los_Angeles";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const src = read("js/reports.js");
const html = read("app.html");
const db = read("js/db.js");

const BASE = new Date(2026, 9, 28); // Wed Oct 28, 2026
const addDays = (n) => { const d = new Date(BASE); d.setDate(d.getDate() + n); return d; };
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dstr = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const ROOMS = [{ code: "A1", name: "Aspen", typeId: "t1" }, { code: "A2", name: "Birch", typeId: "t1" }];
function load({ reservations = [], rooms = ROOMS, taxes = [], rateOverrides = {} } = {}) {
  const doc = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const win = { addEventListener() {}, dispatchEvent() {} };
  const f = new Function("window", "document", "reservations", "rooms", "taxes", "rateOverrides", "balance", "addDays", "isoLocal", "dstr",
    "roomByCode", "TODAY", "dayMs", "money", "esc", "$", "$$", "moneyCurrency", src + "\nreturn window.SHReports;");
  return f(win, doc, reservations, rooms, taxes, rateOverrides, (r) => Math.max(0, r.total - r.paid), addDays, isoLocal, dstr,
    (c) => rooms.find((r) => r.code === c), BASE, 864e5, (v) => "$" + Number(v).toFixed(2), String, () => null, () => [], "USD");
}
const stay = (o) => ({ room: "A1", status: "confirmed", total: 0, paid: 0, tax: 0, source: "direct", ...o });
const data = (res, more = {}) => ({ res, addons: [], txns: [], closures: [], ...more });

test("revenue is before tax and lands on the nights stayed", () => {
  // 6 nights (offsets -9..-4), $600 with $60 tax: $90 a night before tax.
  const R = load();
  const d = data([stay({ inN: -9, outN: -3, total: 600, tax: 60, paid: 600, status: "checked-out" })]);
  const week = R.computeRevenue(d, -6, 0);
  assert.equal(week.revenue, 270, "the 3 nights inside the week");
  assert.equal(week.nightsSold, 3);
  assert.deepEqual(week.buckets.slice(0, 4).map((b) => b.value), [90, 90, 90, 0]);
  assert.equal(week.buckets[0].iso, "2026-10-22");
  assert.equal(week.parts.tax, 30);
  assert.equal(R.computeRevenue(d, -29, 0).revenue, 540, "the whole stay");
  assert.equal(R.computeRevenue(d, 1, 30).count, 0, "nothing ahead");
});

test("firm bookings only; requests are counted apart", () => {
  const R = load();
  const d = data([
    stay({ inN: -2, outN: 1, total: 330, tax: 30 }),
    stay({ room: "A2", inN: -1, outN: 2, total: 200, status: "pending" }),
    stay({ room: "A2", inN: -5, outN: -3, total: 200, status: "cancelled" }),
    stay({ room: "A2", inN: 3, outN: 5, total: 220, tax: 20 })
  ]);
  const last = R.computeRevenue(d, -6, 0);
  assert.deepEqual([last.count, last.requests, last.revenue], [1, 1, 300]);
  const next = R.computeRevenue(d, 1, 30);
  assert.deepEqual([next.count, next.revenue], [1, 200]);
});

test("statistics: closed nights leave the denominator, RevPAR = ADR × occupancy", () => {
  // 2 units × 7 nights = 14. A2 closed on 2 nights it wasn't booked.
  const R = load();
  const d = data([
    stay({ inN: -6, outN: -2, total: 440, tax: 40, paid: 440, bookedN: -20, adults: 2 }),  // 4 nights, $100/night, lead 14
    stay({ room: "A2", inN: -1, outN: 1, total: 0, source: "airbnb", icalFeedId: "f1" }), // 2 nights, no money
    stay({ room: "A2", inN: -4, outN: -2, total: 230, tax: 30, status: "cancelled", bookedN: -9 })
  ], { closures: [{ typeId: "t1", date: isoLocal(addDays(-6)) }, { typeId: "t1", date: isoLocal(addDays(-5)) }] });
  const s = R.computeStats(d, -6, 0);
  assert.deepEqual([s.totalRN, s.closedRN, s.occupiedRN, s.unoccupiedRN], [14, 2, 6, 6], "A1 was booked on the closed nights");
  assert.equal(s.occupancy, 0.5, "6 ÷ (14 − 2)");
  assert.equal(s.adr, 100, "the block fills nights but has no rate");
  assert.equal(s.revpar, r2(400 / 12));
  assert.equal(s.revpar, r2(s.adr * 4 / 12), "RevPAR = ADR × paid nights ÷ available (blocks fill nights, not revenue)");
  assert.deepEqual([s.bookings, s.los, s.lead, s.avgBooking, s.guests], [1, 4, 14, 400, 2]);
  assert.deepEqual([s.cancelled, s.cancelledValue, s.cancelRate], [1, 200, 0.5]);
});
function r2(v) { return Math.round(v * 100) / 100; }

test("occupancy by week, by night of the week and by unit", () => {
  const R = load();
  const d = data([stay({ inN: -13, outN: -6, total: 700, paid: 700 }), stay({ room: "A2", inN: -2, outN: 0, total: 300 })]);
  const o = R.computeOccupancy(d, -13, 0); // two weeks
  assert.equal(o.weeks.length, 2);
  assert.deepEqual(o.weeks.map((w) => [w.available, w.occupied, w.revenue]), [[14, 7, 700], [14, 2, 300]]);
  assert.equal(o.weeks[0].occupancy, 0.5);
  assert.equal(o.dow.reduce((s, x) => s + x.occupied, 0), 9);
  assert.equal(o.dow.reduce((s, x) => s + x.available, 0), 28);
  assert.deepEqual(o.units.map((u) => [u.code, u.nights, u.adr]), [["A1", 7, 100], ["A2", 2, 150]]);
});

test("guests: one row per person (email, else phone, else name), with repeat stays", () => {
  const R = load();
  const d = data([
    stay({ guest: "Ada Lovelace", email: "ADA@example.com", inN: -20, outN: -18, total: 220, tax: 20, paid: 220 }),
    stay({ guest: "Ada L.", email: "ada@example.com", inN: -5, outN: -2, total: 330, tax: 30, paid: 100 }),
    stay({ guest: "Bo", phone: "(970) 555-0101", inN: -4, outN: -3, total: 110, tax: 10 }),
    stay({ guest: "Bo", phone: "970-555-0101", inN: -1, outN: 1, total: 110, tax: 10 }),
    stay({ guest: "Airbnb (Aspen)", inN: -3, outN: -1, icalFeedId: "f1" })
  ]);
  const g = R.computeGuests(d, -29, 0);
  assert.deepEqual(g.guests.map((x) => [x.name, x.stays, x.nights, x.revenue, x.spent]), [["Ada L.", 2, 5, 500, 550], ["Bo", 2, 3, 200, 220]]);
  assert.equal(g.repeat, 2);
});

test("extras: by add-on with how often they're taken, and extra-person fees", () => {
  const R = load();
  const d = data([
    stay({ id: "r1", inN: -3, outN: -1, total: 300, extraPerson: 20 }),
    stay({ id: "r2", room: "A2", inN: -2, outN: 0, total: 300 }),
    stay({ id: "r3", inN: -40, outN: -38, total: 300 })
  ], { addons: [{ resId: "r1", name: "Firewood", amount: 18, qty: 1 }, { resId: "r1", name: "Breakfast", amount: 64, qty: 2 },
    { resId: "r2", name: "Firewood", amount: 18, qty: 1 }, { resId: "r3", name: "Firewood", amount: 18, qty: 1 }] });
  const x = R.computeExtras(d, -6, 0);
  assert.deepEqual(x.rows.map((e) => [e.name, e.bookings, e.qty, e.revenue, e.attach]), [["Breakfast", 1, 2, 64, 0.5], ["Firewood", 2, 2, 36, 1]]);
  assert.deepEqual([x.revenue, x.withExtras, x.stays, x.extraPerson], [100, 2, 2, 20]);
});

const TAXES = [
  { name: "Lodging", kind: "percent", value: 10, applies: "Room only", on: true },
  { name: "Sales", kind: "percent", value: 5, applies: "Room + add-ons", on: true },
  { name: "Tourism", kind: "night", value: 2, applies: "Per night", on: true },
  { name: "Old fee", kind: "percent", value: 9, on: false }
];
// 4 nights: room $400, add-ons $100 → 40 + 25 + 8 = $73 tax.
const TAXED = stay({ id: "t1", ref: "R-9", guest: "Cy", inN: -3, outN: 1, subtotal: 400, discount: 0, extras: 100, extraPerson: 0, tax: 73, total: 573, paid: 286.5 });

test("tax: split by rule the way pricing works it out, by month, with what guests paid", () => {
  const R = load({ taxes: TAXES });
  assert.deepEqual(R.taxSplit(TAXED, R.stayMoney(TAXED)).map(([n, v]) => [n, r2(v)]), [["Lodging", 40], ["Sales", 25], ["Tourism", 8]]);
  // Nights Oct 25..28 are in October; Oct 1 – Nov 30 has two months.
  const t = R.computeTax(data([TAXED]), -27, 33);
  assert.deepEqual(t.rows.map((m) => [m.label, m.tax]), [["October 2026", 73], ["November 2026", 0]]);
  assert.deepEqual([t.tax, t.paid, t.taxable, t.rules.Lodging, t.rules.Sales, t.rules.Tourism], [73, 36.5, 500, 40, 25, 8]);
  // Rules changed since: the total stays what was charged.
  assert.deepEqual(load({ taxes: [TAXES[0]] }).computeTax(data([TAXED]), -27, 3).rules, { Lodging: 73 });
});

test("demo bookings without stored tax back it out of the total", () => {
  const R = load({ taxes: [{ name: "Lodging", kind: "percent", value: 10, on: true }, { name: "Flat", kind: "night", value: 5, on: true }] });
  const m = R.stayMoney({ inN: 0, outN: 2, total: 230 }); // (230 − 10) ÷ 1.1 = 200
  assert.deepEqual([r2(m.net), r2(m.tax)], [200, 30]);
});

test("accounting: invoice lines add up to the booking, payments by method, QuickBooks files", () => {
  const R = load({ taxes: TAXES });
  const b = { ...TAXED, room: "A1", subtotal: 400, discount: 20, extras: 100, extraPerson: 30 };
  b.tax = r2(38 + 26.5 + 8); b.total = r2(400 - 20 + 100 + 30 + b.tax); // tax on 380 room / 510 all
  const d = data([b], {
    addons: [{ resId: "t1", name: "Firewood", amount: 40, qty: 1 }, { resId: "t1", name: "Breakfast", amount: 60, qty: 2 }],
    txns: [{ date: isoLocal(addDays(-3)), ref: "R-9", guest: "Cy", method: "card", amount: 200, fee: 6.1 },
      { date: isoLocal(addDays(-1)), ref: "R-9", guest: "Cy", method: "Cash", amount: 100, fee: 0 },
      { date: isoLocal(addDays(-1)), ref: "R-9", guest: "Cy", method: "card", amount: -50, fee: -1.5 },
      { date: isoLocal(addDays(-60)), ref: "R-1", guest: "Old", method: "Cash", amount: 999, fee: 0 }]
  });
  const a = R.computeAccounting(d, -6, 0);
  const inv = a.invoices[0];
  assert.equal(r2(inv.items.reduce((s, it) => s + it.amount, 0)), b.total, "lines add up to what was charged");
  assert.deepEqual(inv.items.map((it) => it.item), ["Lodging", "Extra person fees", "Extras", "Extras", "Discounts", "Lodging", "Sales", "Tourism"]);
  assert.deepEqual(a.byMethod.map((x) => [x.method, x.count, x.received, x.refunded]), [["Card", 1, 200, 50], ["Cash", 1, 100, 0]]);
  assert.deepEqual([a.received, a.refunded, a.fees], [300, 50, 4.6], "the payment from 60 days ago is outside the period");
  const qb = R.repInvoiceRows(a);
  assert.deepEqual(qb[0], ["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Memo", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount"]);
  assert.deepEqual(qb[1].slice(0, 4), ["R-9", "Cy", "10/25/2026", "10/29/2026"]);
  const pay = R.repPaymentRows(a);
  assert.deepEqual(pay[0].slice(0, 3), ["Date", "Description", "Amount"], "QuickBooks bank upload columns first");
  assert.deepEqual(pay.slice(1).map((p) => [p[0], p[2], p[6]]), [["10/25/2026", "200.00", "Payment"], ["10/27/2026", "100.00", "Payment"], ["10/27/2026", "-50.00", "Refund"]]);
});

test("balances due: stays still owing, by how urgent, without requests or blocks", () => {
  const R = load({ reservations: [
    stay({ ref: "R-1", inN: -5, outN: -2, status: "checked-out", total: 300, paid: 100 }),
    stay({ ref: "R-2", inN: -1, outN: 2, status: "checked-in", total: 300, paid: 0 }),
    stay({ ref: "R-3", inN: 3, outN: 5, total: 200, paid: 50 }),
    stay({ ref: "R-4", inN: 20, outN: 22, total: 200, paid: 0 }),
    stay({ ref: "R-5", inN: 2, outN: 4, total: 200, status: "pending" }),
    stay({ ref: "R-6", inN: 1, outN: 2, total: 100, paid: 100 })
  ] });
  const b = R.computeBalances();
  assert.deepEqual(b.groups.map((g) => [g.key, g.list.map((r) => r.ref), g.due]), [["overdue", ["R-1"], 200], ["inhouse", ["R-2"], 300], ["soon", ["R-3"], 150], ["later", ["R-4"], 200]]);
  assert.equal(b.total, 850);
});

test("arrivals & departures for a day", () => {
  const R = load();
  const d = R.computeDaily(data([
    stay({ ref: "a", room: "A2", inN: 0, outN: 2 }), stay({ ref: "b", inN: -3, outN: 0, status: "checked-in" }),
    stay({ ref: "c", inN: -1, outN: 3, status: "checked-in" }), stay({ ref: "d", inN: 0, outN: 1, status: "cancelled" }),
    stay({ ref: "e", inN: 0, outN: 1, status: "pending", awaitingCard: true })
  ]), 0);
  assert.deepEqual([d.arrivals.map((r) => r.ref), d.departures.map((r) => r.ref), d.staying.map((r) => r.ref)], [["a"], ["b"], ["c"]]);
});

test("a date is the right number of days from today, across daylight saving", () => {
  {
    const today = new Date(2026, 9, 28);
    const R = new Function("window", "document", "TODAY", "dayMs", "isoLocal", "addDays", "$", src + "\nreturn window.SHReports;")(
      { addEventListener() {}, dispatchEvent() {} }, { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }, today, 864e5, isoLocal,
      (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; }, () => null);
    assert.deepEqual(["2026-10-27", "2026-10-28", "2026-10-29", "2026-11-04", "2027-03-20", "2025-01-01"].map(R.repOff), [-1, 0, 1, 7, 143, -665]);
  }
});

test("period presets", () => {
  const R = load();
  assert.deepEqual(R.presetRange("month"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(R.presetRange("lastmonth"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(R.presetRange("next30"), { from: "2026-10-29", to: "2026-11-27" });
  assert.deepEqual(R.presetRange("lastyear"), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(R.presetRange("last7"), { from: "2026-10-22", to: "2026-10-28" });
});

test("long periods chart by week, then by month, and add up", () => {
  const R = load();
  const d = data([stay({ inN: -80, outN: -70, total: 1000, source: "expedia" }), stay({ room: "A2", inN: -20, outN: -15, total: 500, source: "" })]);
  const q = R.computeRevenue(d, -89, 0);
  assert.equal(q.mode, "week");
  assert.equal(q.buckets.length, 13);
  assert.equal(Math.round(q.buckets.reduce((s, b) => s + b.value, 0)), 1500);
  assert.deepEqual(q.sources.map((s) => s.key), ["direct", "other"]);
  const y = R.computeRevenue(d, -300, 0);
  assert.equal(y.mode, "month");
  assert.equal(Math.round(y.buckets.reduce((s, b) => s + b.value, 0)), 1500);
});

test("dates stay on midnight across daylight saving (every booking date and chart label)", () => {
  {
    const line = app.match(/const addDays = \(n\) => \{[^\n]*\};/)[0];
    const add = new Function("TODAY", line + "\nreturn addDays;")(new Date(2026, 9, 28));
    for (let n = 0; n <= 400; n++) {
      const d = add(n);
      assert.equal(d.getHours(), 0, `day ${n}`);
      assert.equal(Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 9, 28)) / 864e5), n);
    }
    assert.equal(add(7).toDateString(), "Wed Nov 04 2026", "Nov 1 change: no longer shows Nov 3");
  }
});

test("wired up: sub-pages in the sidebar and the address, data for old periods, exports", () => {
  assert.match(html, /data-view="reports"[^\n]*\n\s+<div class="nav-sub" id="navReports" hidden><\/div>/);
  assert.match(html, /<script src="js\/reservation\.js"><\/script>\n<script src="js\/reports\.js"><\/script>/, "after app.js, whose helpers it uses");
  for (const id of ["repPreset", "repFrom", "repTo", "repDay", "repBody"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.equal((src.match(/^\s+\{ key: "[a-z]+", label: "/gm) || []).length, 9, "nine reports");
  assert.match(app, /split\("\/"\)\[0\]; \/\/ #reports\/tax opens Reports/);
  assert.match(app, /function renderReports\(\) \{ if \(window\.SHReports\) SHReports\.render\(\); \}/);
  assert.match(app, /if \(activeView === "view-reports"\) \{ if \(window\.SHReports\) SHReports\.exportCsv\(\); \}/);
  assert.match(src, /const covered = from >= SHDB\.historyStart\(\);/, "older periods are fetched, not guessed from what's loaded");
  assert.match(db, /historyStart, reportReservations, reportAddons, reportTransactions, reportClosures/);
  assert.match(db, /status=in\.\(paid,refunded\)/, "payments and refunds, not pending or failed");
  assert.match(db, /bookedN: r\.created_at \? dayOff\(isoDay\(new Date\(r\.created_at\)\.getTime\(\)\)\) : null/);
});
