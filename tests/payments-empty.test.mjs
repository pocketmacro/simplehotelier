// Focused test: Payments page on a brand-new account shows no charges.
// Regression: KPI cards were hardcoded ($16.1k collected, $2.3k outstanding,
// $4.8k payout) regardless of the account's actual folios/transactions.
// Run: node --test tests/payments-empty.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

// --- Source guards: no fabricated figures in the static Payments markup ---
test("payments markup contains no hardcoded charge figures", () => {
  const view = html.slice(html.indexOf('id="view-payments"'), html.indexOf("<!-- ===== ADDONS"));
  assert.ok(view.length > 0, "payments view not found");
  assert.doesNotMatch(view, /\$16\.1|\$2\.3|\$4\.8|92 charges|4412/);
});

// --- Behaviour: run the real Payments renderers against stub DOM nodes ---
const els = {};
function stubEl() { return { innerHTML: "", textContent: "" }; }
globalThis.document = undefined;
const $ = (sel) => {
  if (!els[sel]) els[sel] = stubEl();
  return els[sel];
};
// Minimal helpers the renderers use (same shapes as js/app.js).
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pill = ([cls, label]) => `<span class="pill ${cls}"><i></i>${label}</span>`;
const balance = (r) => Math.max(0, r.total - r.paid);
let reservations = [];
let txns = [];

const statsAt = app.indexOf("function renderPaymentStats()");
const start = statsAt >= 0 ? statsAt : app.indexOf("function renderFolios()");
const end = app.indexOf("/* ---------------- Add-ons + taxes");
assert.ok(start >= 0 && end > start, "payments renderers not found in js/app.js");
eval(app.slice(start, end) + "\n;globalThis.__renderFolios = renderFolios; globalThis.__renderTxns = renderTxns;");
const renderFolios = globalThis.__renderFolios;
const renderTxns = globalThis.__renderTxns;

test("new account (no reservations, no transactions) shows zero charges", () => {
  reservations = [];
  txns = [];
  renderFolios();
  renderTxns();
  assert.equal($("#payCollected").textContent, "$0.00");
  assert.equal($("#payCollectedSub").textContent, "0 charges");
  assert.equal($("#payOutstanding").textContent, "$0.00");
  assert.equal($("#payOutstandingSub").textContent, "Across 0 open folios");
  assert.match($("#folioTable tbody").innerHTML, /All folios settled/);
  assert.match($("#txnTable tbody").innerHTML, /No transactions yet/);
});

test("KPIs are computed from the account's actual folios and transactions", () => {
  reservations = [
    { ref: "R-1", guest: "Ana", contact: "a@x.com", room: "A1", status: "confirmed", total: 300, paid: 100 },
    { ref: "R-2", guest: "Ben", contact: "b@x.com", room: "A2", status: "cancelled", total: 500, paid: 0 },
    { ref: "R-3", guest: "Cid", contact: "c@x.com", room: "A3", status: "confirmed", total: 200, paid: 200 }
  ];
  txns = [
    { when: "Today", desc: "R-3 · Full", method: "Card", status: "paid", amount: 200 },
    { when: "Today", desc: "R-1 · Deposit", method: "Cash", status: "paid", amount: 100 },
    { when: "Yesterday", desc: "R-9 · Refund", method: "Card", status: "refunded", amount: -50 }
  ];
  renderFolios();
  renderTxns();
  assert.equal($("#payCollected").textContent, "$300.00");
  assert.equal($("#payCollectedSub").textContent, "2 charges");
  // Only R-1 owes: $200 across 1 open folio (cancelled R-2 excluded).
  assert.equal($("#payOutstanding").textContent, "$200.00");
  assert.equal($("#payOutstandingSub").textContent, "Across 1 open folio");
  assert.match($("#txnTable tbody").innerHTML, /R-3 · Full/);
});
