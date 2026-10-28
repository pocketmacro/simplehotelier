// Focused test: a booking's life from request to check-out. Risks covered:
// a guest who paid still shown as a request, no way to check a guest in or
// out, a guest checked out with money owed by accident, a Save after a
// payment quietly setting a confirmed booking back to pending, the room
// still showing vacant with a guest in it, an abandoned online checkout
// confirmed by mistake, and the owner emailed "new booking" by their own
// confirmations.
// Run: node --test tests/stay-steps.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const rxjs = read("js/reservation.js");
const db = read("js/db.js");
const book = read("js/book.js");
const mail = read("supabase/functions/send-email/index.ts");
const sql = read("supabase/migrations/20261202000000_paid_bookings_confirmed.sql");

test("database: money or a card confirms a pending booking, nothing else does", () => {
  assert.match(sql, /if old\.status = 'pending' and new\.status = 'pending'\s+and \(coalesce\(new\.paid_cents, 0\) > coalesce\(old\.paid_cents, 0\)\s+or \(old\.stripe_payment_method_id is null and new\.stripe_payment_method_id is not null\)\) then\s+new\.status := 'confirmed';/);
  assert.match(sql, /create trigger trg_reservations_confirm_when_paid before update on public\.reservations\s+for each row/);
  assert.match(sql, /update public\.reservations\s+set status = 'confirmed'\s+where status = 'pending' and \(paid_cents > 0 or stripe_payment_method_id is not null\);/, "bookings already paid");
});

/* nextStep / stepButton / statusPill / syncRoomOccupancy from js/app.js. */
const helpers = app.slice(app.indexOf("const statusPill"), app.indexOf("/* ---------------- Overview"));
const H = (rooms, reservations) => new Function("rooms", "reservations", "pill", "ST", "esc",
  helpers + "\nreturn { nextStep, stepButton, statusPill, syncRoomOccupancy };")(
  rooms, reservations, ([c, l]) => `${c}:${l}`, { pending: ["pending", "Pending"], confirmed: ["confirmed", "Confirmed"] }, String);

test("one next step per booking: Confirm, Check in, Check out", () => {
  const { nextStep } = H([], []);
  const step = (r) => (nextStep(r) || [null])[0];
  assert.equal(step({ status: "pending", inN: 5, outN: 7 }), "confirm");
  assert.equal(step({ status: "confirmed", inN: 1, outN: 3 }), null, "not before their check-in day");
  assert.equal(step({ status: "confirmed", inN: 0, outN: 3 }), "checkin");
  assert.equal(step({ status: "confirmed", inN: -1, outN: 2 }), "checkin", "arrived late");
  assert.equal(step({ status: "confirmed", inN: -4, outN: -1 }), null, "a stay already over");
  assert.equal(step({ status: "checked-in", inN: -2, outN: 0 }), "checkout");
  assert.equal(step({ status: "checked-out", inN: -3, outN: 0 }), null);
  assert.equal(step({ status: "cancelled", inN: 0, outN: 2 }), null);
  assert.equal(step({ status: "confirmed", inN: 0, outN: 2, icalFeedId: "f1" }), null, "Airbnb/Vrbo blocks are replaced at the next sync");
  assert.equal(step({ status: "pending", inN: 0, outN: 2, awaitingCard: true }), null, "an abandoned checkout is released, not confirmed");
});

test("the lists show the step, and a card-less online checkout reads Awaiting card", () => {
  const { stepButton, statusPill } = H([], []);
  assert.equal(stepButton({ ref: "R-1", status: "checked-in", inN: -1, outN: 0 }),
    `<button class="btn btn-primary btn-xs" data-action="res-step" data-step="checkout" data-ref="R-1" type="button">Check out</button>`);
  assert.equal(statusPill({ status: "pending", awaitingCard: true }), "pending:Awaiting card");
  assert.match(app, /<div class="ri-right">\$\{statusPill\(r\)\}\$\{stepButton\(r\)\}<\/div>/, "Today's movement");
  assert.match(app, /<td style="white-space:nowrap;text-align:right">\s+\$\{stepButton\(r\)\}/, "Reservations table");
  assert.match(app, /active\.filter\(\(r\) => r\.status === "pending" && !r\.awaitingCard\)/, "Needs attention counts real requests");
  assert.match(db, /awaitingCard: r\.status === "pending" && !!r\.card_required && !r\.stripe_payment_method_id && !\(r\.paid_cents > 0\)/);
});

test("rooms follow their guests: occupied, reserved, vacant", () => {
  const rooms = [{ code: "A1" }, { code: "A2" }, { code: "A3" }, { code: "A4" }];
  const res = [
    { room: "A1", status: "checked-in", guest: "Ada", inN: -1, outN: 1 },
    { room: "A2", status: "confirmed", guest: "Bo", inN: 0, outN: 2 },
    { room: "A3", status: "confirmed", guest: "Cy", inN: 3, outN: 5 },
    { room: "A4", status: "checked-out", guest: "Di", inN: -2, outN: 0 }
  ];
  H(rooms, res).syncRoomOccupancy();
  assert.deepEqual(rooms.map((r) => [r.status, r.guest]), [["occupied", "Ada"], ["reserved", ""], ["vacant", ""], ["vacant", ""]]);
  assert.match(app, /function renderRooms\(\) \{\s+syncRoomOccupancy\(\);/);
  assert.match(app, /function renderMiniRooms\(\) \{\s+syncRoomOccupancy\(\);/);
});

/* resStep and turnRoom from js/app.js, against stubs. */
function steps({ live = true, fail = false } = {}) {
  const src = app.slice(app.indexOf("/* ---------------- Confirm, check in, check out"), app.indexOf("/* ---------------- Global action dispatch"));
  const log = [];
  const rooms = [{ code: "A1", id: "room-1", hk: "clean" }];
  const reservations = [
    { ref: "R-1", id: "id-1", guest: "Ada", room: "A1", status: "checked-in", total: 500, paid: 500, email: "ada@example.com" },
    { ref: "R-2", id: "id-2", guest: "Bo", room: "A1", status: "checked-in", total: 500, paid: 200, card: { last4: "4242" } },
    { ref: "R-3", id: "id-3", guest: "Cy", room: "A1", status: "pending", total: 300, paid: 0, email: "cy@example.com" }
  ];
  const SHDB = {
    hasLive: () => live,
    setReservationStatus: async (id, s) => { if (fail) throw new Error("offline"); log.push(["status", id, s]); },
    updateHK: (room) => log.push(["hk", room.code, room.hk])
  };
  const noop = () => {};
  const f = new Function("reservations", "balance", "openReservationEditor", "SHDB", "window", "toast", "fnInvoke", "roomByCode",
    "renderReservations", "renderToday", "renderOverview", "renderCalendar", "renderRooms", "renderMiniRooms", "renderFolios", "renderHK", "renderReports",
    src + "\nreturn { resStep, turnRoom };");
  const api = f(reservations, (r) => Math.max(0, r.total - r.paid), (ref, o) => log.push(["editor", ref, o]), SHDB, { SHDB },
    (t) => log.push(["toast", t]), async (name, body) => { log.push(["fn", name, body]); return { sent: true }; },
    (c) => rooms.find((r) => r.code === c), noop, noop, noop, noop, noop, noop, noop, noop, noop);
  return { ...api, log, rooms, reservations };
}

test("check out: paid up checks out and flags the room; money owed opens the payment panel", async () => {
  const s = steps();
  await s.resStep("R-1", "checkout");
  assert.equal(s.reservations[0].status, "checked-out");
  assert.deepEqual(s.log.slice(0, 2), [["status", "id-1", "checked-out"], ["hk", "A1", "dirty"]]);
  await s.resStep("R-2", "checkout");
  assert.equal(s.reservations[1].status, "checked-in", "not checked out while owing");
  assert.deepEqual(s.log.at(-1), ["editor", "R-2", { panel: "charge", checkout: true }]);
});

test("confirm emails the guest; a failed save changes nothing", async () => {
  const s = steps();
  await s.resStep("R-3", "confirm");
  assert.equal(s.reservations[2].status, "confirmed");
  assert.deepEqual(s.log.find((l) => l[0] === "fn"), ["fn", "send-email", { action: "booking_confirmation", reservation_id: "id-3", force: true }]);
  const bad = steps({ fail: true });
  await bad.resStep("R-1", "checkout");
  assert.equal(bad.reservations[0].status, "checked-in");
  assert.equal(bad.rooms[0].hk, "clean");
  const demo = steps({ live: false });
  await demo.resStep("R-3", "confirm");
  assert.equal(demo.reservations[2].status, "confirmed");
  assert.ok(!demo.log.some((l) => l[0] === "fn" || l[0] === "status"), "demo: nothing sent or saved");
});

test("booking window: the same step, payment before check-out, and status follows payments", () => {
  assert.match(rxjs, /const step = isNew \|\| rx\.readOnly \? null : nextStep\(rx\.base\);/);
  assert.match(rxjs, /data-rx="step" data-step="\$\{step\[0\]\}">\$\{step\[1\]\}<\/button>/);
  assert.match(rxjs, /still owed\. Take payment to check out\. <button[^>]*data-rx="checkout-anyway">Check out anyway<\/button>/);
  const stepFn = rxjs.match(/function rxStep\(step\) \{[\s\S]*?\n\}/)[0];
  assert.match(stepFn, /if \(step === "checkout" && rxOutstanding\(\) > 0\.004\) \{\s+rx\.confirmCheckout = true;/);
  // After money moves: a pending booking the database confirmed stays confirmed on Save,
  // and a check-out waiting on the balance finishes once it's paid in full.
  const reload = rxjs.match(/async function rxReload\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(reload, /if \(moved && rx\.form\.status === rxStatusApp\(was\)\) rx\.form\.status = rxStatusApp\(bundle\.row\.status\);/);
  assert.match(reload, /if \(rx\.confirmCheckout && rxOutstanding\(\) <= 0\.004\) \{ await rxSave\("checked-out"\); return; \}/);
  assert.match(rxjs, /if \(mapped\.status === "checked-out" && was !== "checked-out"\) turnRoom\(room\.code\);/);
});

test("guests who paid or saved a card read Booking confirmed", () => {
  const fn = book.match(/function showSuccess\(code, total, extra\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /\$\("#successPanel h2"\)\.textContent = paid \? "Booking confirmed" : "Request received";/);
  assert.match(fn, /is confirmed\. Your confirmation email is on its way\./);
  assert.match(fn, /will confirm your " \+ state\.selected\.name \+ " stay by email shortly\./, "a request still says the property confirms");
});

test("owner emails: a request asks for Confirm; their own confirmations don't email them", () => {
  assert.match(mail, /const ownerTo = force \? "" : tenant\?\.booking_email \|\| tenant\?\.contact_email;/);
  assert.match(mail, /subject: `\$\{pending \? "Booking request" : "New booking"\}/);
  assert.match(mail, /choose Confirm to accept it/);
});

test("Spark explains the statuses without taking over invite questions", () => {
  globalThis.window = { SH_CONFIG: {} };
  new Function("window", read("js/site.js"))(globalThis.window);
  const doc = { querySelector: () => null, addEventListener: () => {} };
  new Function("window", "document", "location", "localStorage", read("js/support.js"))(
    globalThis.window, doc, { search: "", protocol: "https:", origin: "https://example.com" }, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const S = globalThis.window.SHSupport;
  for (const q of ["What does pending mean?", "How do I check in a guest?", "How do I check out a guest?", "What does Awaiting card mean?"]) {
    assert.equal(S.answer(q).id, "stays", q);
  }
  assert.equal(S.answer("How do I revoke pending invites?").id, "team");
  assert.equal(S.answer("Can guests add late checkout?").id, "addons");
});
