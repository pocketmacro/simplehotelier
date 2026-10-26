// Focused tests: iCal parse/build + weekly report math (shared Edge Function helpers).
// Run: node --test tests/ical-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICS, buildICS, icalDateToISO, nightsBetween, importCode } from "../supabase/functions/_shared/ical.js";
import { computeWeeklyStats, overlapNights } from "../supabase/functions/_shared/report.js";

const AIRBNB = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Airbnb//EN",
  "BEGIN:VEVENT", "UID:abc123@airbnb.com", "DTSTART;VALUE=DATE:20261220", "DTEND;VALUE=DATE:20261227",
  "SUMMARY:Reserved", "END:VEVENT",
  "BEGIN:VEVENT", "UID:def456@airbnb.com", "DTSTART;TZID=America/Denver:20270101T150000", "DTEND;TZID=America/Denver:20270103T103000",
  "SUMMARY:Reserved - John D.", "END:VEVENT",
  "BEGIN:VEVENT", "UID:sameday@airbnb.com", "DTSTART;VALUE=DATE:20270105", "DTEND;VALUE=DATE:20270105",
  "SUMMARY:Blocked", "END:VEVENT",
  "END:VCALENDAR"
].join("\r\n");

test("parseICS reads date and datetime events, normalizing to stay ranges", () => {
  const events = parseICS(AIRBNB);
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], { uid: "abc123@airbnb.com", summary: "Reserved", start: "2026-12-20", end: "2026-12-27" });
  assert.equal(events[1].start, "2027-01-01");
  assert.equal(events[1].end, "2027-01-03");
  assert.equal(events[2].end, "2027-01-06"); // zero-length stay becomes one night
  assert.equal(nightsBetween(events[0].start, events[0].end), 7);
});

test("buildICS round-trips through parseICS", () => {
  const ics = buildICS([{ uid: "SH-1@simplehotelier.com", summary: "Reserved · A1 Cabin, West", start: "2026-11-02", end: "2026-11-05" }], "Pinecrest");
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Reserved · A1 Cabin\\, West/);
  const back = parseICS(ics);
  assert.equal(back.length, 1);
  assert.equal(back[0].start, "2026-11-02");
  assert.equal(back[0].end, "2026-11-05");
  assert.equal(back[0].summary, "Reserved · A1 Cabin, West");
});

test("icalDateToISO handles compact, dashed and datetime forms", () => {
  assert.equal(icalDateToISO("20261220"), "2026-12-20");
  assert.equal(icalDateToISO("2026-12-20"), "2026-12-20");
  assert.equal(icalDateToISO("20261220T150000Z"), "2026-12-20");
  assert.equal(icalDateToISO(""), null);
  assert.equal(icalDateToISO("not a date"), null);
});

test("importCode is stable per uid", () => {
  assert.equal(importCode("abc123@airbnb.com"), importCode("abc123@airbnb.com"));
  assert.notEqual(importCode("abc123@airbnb.com"), importCode("other@airbnb.com"));
  assert.match(importCode("x"), /^ICAL-/);
});

test("computeWeeklyStats: occupancy, revenue and arrivals", () => {
  const stats = computeWeeklyStats({
    roomCount: 2,
    weekStart: "2026-10-19", // Monday
    today: "2026-10-26",
    reservations: [
      { guest_name: "A", confirmation_code: "SH-A", check_in: "2026-10-19", check_out: "2026-10-23", status: "checked_out", paid_cents: 50000, total_cents: 50000, created_at: "2026-10-01T10:00:00Z" },
      { guest_name: "B", confirmation_code: "SH-B", check_in: "2026-10-24", check_out: "2026-10-26", status: "checked_out", paid_cents: 20000, total_cents: 20000, created_at: "2026-10-20T10:00:00Z" },
      { guest_name: "C", confirmation_code: "SH-C", check_in: "2026-10-28", check_out: "2026-10-30", status: "confirmed", paid_cents: 0, total_cents: 30000, created_at: "2026-10-25T10:00:00Z" },
      { guest_name: "D", confirmation_code: "SH-D", check_in: "2026-10-20", check_out: "2026-10-22", status: "cancelled", paid_cents: 0, total_cents: 10000, created_at: "2026-10-20T10:00:00Z" }
    ],
    transactions: [
      { status: "paid", amount_cents: 50000, created_at: "2026-10-20T12:00:00Z" },
      { status: "paid", amount_cents: 20000, created_at: "2026-10-25T12:00:00Z" },
      { status: "paid", amount_cents: 99900, created_at: "2026-10-10T12:00:00Z" },
      { status: "pending", amount_cents: 77700, created_at: "2026-10-21T12:00:00Z" }
    ]
  });
  assert.equal(stats.nightsBooked, 6); // 4 + 2, cancelled excluded
  assert.equal(stats.possibleNights, 14);
  assert.equal(stats.occupancyPct, 42.9);
  assert.equal(stats.revenueCents, 70000); // only paid txns inside the week
  assert.equal(stats.arrivals.length, 1);
  assert.equal(stats.arrivals[0].guest, "C");
  assert.equal(stats.newBookings, 2); // B + C created in week, cancelled excluded
  assert.equal(overlapNights({ check_in: "2026-10-25", check_out: "2026-10-28" }, "2026-10-19", "2026-10-26"), 1);
});
