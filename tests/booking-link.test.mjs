// Focused test: a link can open the booking page on a stay (dates + party),
// the landing page channels like Google Hotels send guests to, and the
// service-only ARI feed (20261201000000_ari_snapshot) those channels read.
// Risk covered: bad or past dates in a link breaking the page, "today" being
// the UTC day (US evenings couldn't book tonight), the linked party being
// reset on load, and the feed becoming browser-callable.
// tests/rls/checks.sql R107 proves the feed's rates match quote_stay() live.
// Run: node --test tests/booking-link.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const book = read("js/book.js");

// Run the real link block with a fake page and query string.
const block = book.slice(book.indexOf("  const d = (off) => {"), book.indexOf('  $("#roomsList").addEventListener("click"'));
function open(query) {
  const inputs = { "#inDate": { value: "" }, "#outDate": { value: "" } };
  const run = new Function("params", "$", block + "\nreturn { linkStay, linkParty, d };");
  const out = run(new URLSearchParams(query), (s) => inputs[s]);
  return { in: inputs["#inDate"].value, out: inputs["#outDate"].value, ...out };
}
const local = (off) => {
  const x = new Date(); x.setDate(x.getDate() + off);
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
};

test("without a stay in the link: a week out, two nights, local days", () => {
  const p = open("property=pinecrest");
  assert.equal(p.in, local(7));
  assert.equal(p.out, local(9));
  assert.equal(p.d(0), local(0));
  assert.equal(p.linkStay, false);
  assert.equal(p.linkParty, null);
});

test("checkin + checkout or nights set the stay", () => {
  const a = local(30), b = local(33);
  let p = open(`checkin=${a}&checkout=${b}`);
  assert.deepEqual([p.in, p.out, p.linkStay], [a, b, true]);
  p = open(`checkin=${a}&nights=3`);
  assert.deepEqual([p.in, p.out], [a, b]);
  p = open(`checkin=${local(0)}&nights=1`);
  assert.deepEqual([p.in, p.out], [local(0), local(1)], "tonight works");
});

test("invalid stays fall back to the defaults", () => {
  for (const q of [
    `checkin=${local(-1)}&nights=2`,                // in the past
    `checkin=${local(5)}&checkout=${local(5)}`,     // zero nights
    `checkin=${local(5)}&checkout=${local(3)}`,     // backwards
    `checkin=${local(5)}&nights=400`,               // too long
    `checkin=${local(5)}&checkout=${local(400)}`,
    "checkin=2027-02-30&nights=2",                  // no such day
    "checkin=12/01/2027&nights=2",
    `checkin=${local(5)}`,                          // no end
    "checkin=<script>&checkout=x"
  ]) {
    const p = open(q);
    assert.deepEqual([p.in, p.out, p.linkStay], [local(7), local(9), false], q);
  }
});

test("adults and children come through; nonsense is ignored", () => {
  assert.deepEqual(open("adults=3&children=2").linkParty, { adults: 3, children: 2, infants: 0 });
  assert.deepEqual(open("adults=1").linkParty, { adults: 1, children: 0, infants: 0 });
  assert.deepEqual(open("adults=2&children=-4").linkParty, { adults: 2, children: 0, infants: 0 });
  assert.equal(open("adults=0&children=2").linkParty, null);
  assert.equal(open("adults=lots").linkParty, null);
});

test("load keeps the linked party (within limits) and checks availability for linked dates", () => {
  assert.match(book, /if \(linkParty && splitParty\(\)\) setParty\(linkParty\);\n\s+else setGuests\(linkParty \? linkParty\.adults \+ linkParty\.children : guestsCount\(\)\);/);
  assert.match(book, /if \(paidRef\) showPaidThanks\(\);\n\s+else if \(linkStay\) checkAvailability\(\);/);
});

test("the ARI feed is service-role only and checked live", () => {
  const sql = read("supabase/migrations/20261201000000_ari_snapshot.sql");
  assert.match(sql, /language plpgsql stable security definer set search_path = public/);
  assert.match(sql, /revoke execute on function public\.ari_snapshot\(uuid, date, date\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.ari_snapshot\(uuid, date, date\) to service_role;/);
  assert.match(sql, /x\.status in \('pending', 'confirmed', 'checked_in'\)/, "same busy statuses as create_booking");
  const checks = read("tests/rls/checks.sql");
  assert.match(checks, /R107 ari_snapshot \(the channel feed\) is refused to browsers/);
  assert.match(checks, /'create_booking', 'release_abandoned_holds', 'ari_snapshot'\);/);
});
