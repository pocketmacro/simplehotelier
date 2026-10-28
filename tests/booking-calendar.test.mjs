// Focused test: the booking page's calendar crosses out dates nobody can
// book. Risks covered: a sold-out night offered as a check-in, a check-out
// past a night that's taken in every room, a closed or no-arrival day that
// looks bookable, a stay shorter than the minimum, a room too small for the
// party counted as free, dates outside what's known crossed out, and the
// database function leaking guest details or anything beyond busy nights.
// Run: node --test tests/booking-calendar.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const book = read("js/book.js");
const pickers = read("js/pickers.js");
const sql = read("supabase/migrations/20261203000000_booking_calendar.sql");
const block = book.slice(book.indexOf("  /* Calendar: cross out dates nobody can book."), book.indexOf("  /* Guests: a −/+ stepper"));

/* Two cabins: A (sleeps 2) is booked Nov 4–6; B (sleeps 6, type "big") is
   closed the night of Nov 5, takes no arrivals on Nov 8, needs 3 nights
   from Nov 10, and takes no departures on Nov 20. */
async function calendar({ guests = 2, busy = { A: [["2026-11-04", "2026-11-06"]], B: [] } } = {}) {
  const inputs = { "#inDate": {}, "#outDate": {} };
  const state = {
    tenant: { id: "t1" },
    rooms: [{ id: "A", sleeps: 2, room_type_id: "small" }, { id: "B", sleeps: 6, room_type_id: "big" }],
    types: { small: { max_occupants: 2 }, big: { max_occupants: 6 } },
    overrides: { "big|2026-11-05": { closed: true }, "big|2026-11-08": { cta: true }, "big|2026-11-10": { minStay: 3 }, "big|2026-11-20": { ctd: true } }
  };
  const api = async (path, opts) => {
    assert.equal(path, "rpc/booking_calendar");
    const body = JSON.parse(opts.body);
    assert.deepEqual([body.p_tenant, body.p_from, body.p_to], ["t1", "2026-10-28", "2028-04-28"]);
    return Object.entries(busy).map(([room, list]) => ({ room, busy: list }));
  };
  const f = new Function("state", "api", "d", "$", "guestsCount", "party", "partyProblem",
    block + "\nreturn { loadCalendar, arrivalDay, departureDay };");
  const C = f(state, api, () => "2026-10-28", (id) => inputs[id], () => guests, { adults: guests, children: 0 }, () => null);
  assert.equal(C.arrivalDay("2026-11-05"), null, "nothing crossed out before it loads");
  await C.loadCalendar();
  return { ...C, inputs };
}

test("check-in: open while some room that fits is free and takes arrivals", async () => {
  const C = await calendar();
  assert.equal(C.arrivalDay("2026-11-04"), null, "A is booked, B is free");
  assert.deepEqual(C.arrivalDay("2026-11-05"), { off: true, label: "sold out" }, "A booked, B closed");
  assert.deepEqual(C.arrivalDay("2026-11-08"), null, "B takes no arrivals, but A is free");
  assert.equal(C.arrivalDay("2026-12-01"), null);
  assert.equal(C.arrivalDay("2028-06-01"), null, "beyond the 18 months loaded: not crossed out");
  assert.equal(typeof C.inputs["#inDate"].pkDay, "function");
  assert.equal(C.inputs["#inDate"].pkDay("2026-11-05").label, "sold out", "wired to the check-in picker");
});

test("a big party only counts the room that sleeps them", async () => {
  const C = await calendar({ guests: 4 });
  assert.deepEqual(C.arrivalDay("2026-11-08"), { off: true, label: "no arrivals on this day" }, "only B fits, and it takes no arrivals");
  assert.equal(C.arrivalDay("2026-11-04"), null, "B is free though A isn't");
});

test("check-out: as far as one room stays free, within its rules", async () => {
  const C = await calendar();
  // From Nov 3: A is taken from Nov 4, B closed Nov 5 → leave Nov 4 or 5.
  assert.equal(C.departureDay("2026-11-04", "2026-11-03"), null);
  assert.equal(C.departureDay("2026-11-05", "2026-11-03"), null);
  assert.deepEqual(C.departureDay("2026-11-06", "2026-11-03"), { off: true, label: "not available from your check-in" });
  assert.equal(C.departureDay("2026-11-03", "2026-11-03"), null, "on or before check-in is the picker's own rule");
  // From Nov 10 only B needs 3 nights; A (free) has no minimum.
  assert.equal(C.departureDay("2026-11-11", "2026-11-10"), null, "A can do one night");
  const big = await calendar({ guests: 4 });
  assert.ok(big.departureDay("2026-11-11", "2026-11-10").off, "B needs 3 nights from Nov 10");
  assert.equal(big.departureDay("2026-11-13", "2026-11-10"), null);
  assert.ok(big.departureDay("2026-11-20", "2026-11-12").off, "B takes no departures on Nov 20");
  assert.equal(big.inputs["#outDate"].pkDay("2026-11-13", "2026-11-10"), null, "wired to the check-out picker");
});

test("everything taken: every check-in crossed out until the rooms free up", async () => {
  const C = await calendar({ busy: { A: [["2026-11-01", "2026-11-10"]], B: [["2026-11-02", "2026-11-09"]] } });
  assert.equal(C.arrivalDay("2026-11-01"), null);
  for (const day of ["2026-11-02", "2026-11-05", "2026-11-08"]) assert.equal(C.arrivalDay(day).label, "sold out", day);
  assert.equal(C.arrivalDay("2026-11-09"), null, "B frees up");
  assert.equal(C.departureDay("2026-11-02", "2026-11-01"), null);
  assert.ok(C.departureDay("2026-11-03", "2026-11-01").off, "B taken from Nov 2, A from Nov 1");
});

test("the picker honours the page's crossed-out days, and keyboard focus can still land on them", () => {
  assert.match(pickers, /const ok = inRange\(d, input\) && !\(info && info\.off\);/);
  assert.match(pickers, /\$\{ok \? "" : ' aria-disabled="true"'\}/, "aria-disabled, not disabled: still focusable");
  assert.match(pickers, /if \(!b \|\| b\.disabled \|\| b\.getAttribute\("aria-disabled"\) === "true"\) return;/, "and can't be picked");
  assert.match(pickers, /aria-label="\$\{esc\(longDate\(d\) \+ \(why \? ", " \+ why : ""\)\)\}"/, "says why");
  assert.match(book, /loadCalendar\(\); \/\/ booked nights for the date picker; nothing waits for it/);
});

test("database: busy nights only, for rooms of that property, in a bounded window", () => {
  assert.match(sql, /jsonb_build_object\('room', r\.id, 'busy', /);
  assert.doesNotMatch(sql, /guest_|confirmation_code|total_cents|notes/, "no guest or booking details");
  assert.match(sql, /res\.status in \('pending', 'confirmed', 'checked_in'\)/, "the same stays get_available_room_ids counts");
  assert.match(sql, /where r\.tenant_id = p_tenant\s+and p_from is not null and p_to > p_from and p_to - p_from <= 550/);
  assert.match(sql, /revoke execute on function public\.booking_calendar\(uuid, date, date\) from public;\ngrant execute on function public\.booking_calendar\(uuid, date, date\) to anon, authenticated;/);
});
