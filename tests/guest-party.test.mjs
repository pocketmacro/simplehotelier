// Focused test: guests describe their party (adults / children / infants)
// and, when the property asks, their home address.
// Risks covered: the extra-guest charge was one rate per night however many
// extra guests came; adult/child/infant limits were never applied online;
// the booking page's preview must match the server's price to the cent.
// The SQL side is proven on live by tests/rls/checks.sql R56-R57; this file
// runs the page's own math against the same cases.
// Run: node --test tests/guest-party.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
globalThis.window = {};
globalThis.document = {};
eval(read("js/book.js"));
const { occupancyCharge, partyProblem } = window.SHBookCalc;

// Same room type as R56: $20 extra adult, $10 child, $5 infant, 2 included.
const rates = { included: 2, adultRate: 20, childRate: 10, infantRate: 5 };
const cents = (o) => Math.round(occupancyCharge({ ...rates, ...o }).perNight * 100);

test("extra guests pay per person per night, children and infants at their rates (matches R56)", () => {
  assert.equal(cents({ adults: 3 }), 2000, "legacy3: one extra adult");
  assert.equal(cents({ adults: 2, children: 1, infants: 1 }), 1500, "a2c1i1: child + infant");
  assert.equal(cents({ adults: 1, children: 2 }), 1000, "a1c2: one child uses the free adult place");
  assert.equal(cents({ adults: 3, children: 1 }), 3000, "a3c1: extra adult + child");
  assert.equal(cents({ adults: 3 }) * 2, 4000, "a3x2n: per night, two nights");
  assert.equal(cents({ adults: 2, children: 2, childRate: 0 }), 4000, "no child rate: children pay the adult rate");
  assert.equal(cents({ adults: 4 }), 4000, "two extra adults pay twice (was charged once)");
  assert.equal(cents({ adults: 2, infants: 3, infantRate: 0 }), 0, "infants are free without an infant rate");
  assert.equal(occupancyCharge({ ...rates, adults: 2, children: 1, infants: 1 }).count, 2);
});

test("adult/child/infant limits from the room type and the property (matches R56)", () => {
  const type = { max_adults: 3, max_children: 2, max_infants: 1, adults_required: 1 };
  assert.equal(partyProblem({ adults: 4, children: 0, infants: 0 }, type, {}), "Up to 3 adults");
  assert.equal(partyProblem({ adults: 1, children: 3, infants: 0 }, type, {}), "Up to 2 children");
  assert.equal(partyProblem({ adults: 2, children: 0, infants: 2 }, type, {}), "Up to 1 infant");
  assert.equal(partyProblem({ adults: 2, children: 2, infants: 1 }, type, {}), "");
  assert.equal(partyProblem({ adults: 1, children: 0, infants: 0 }, { adults_required: 2 }, {}), "Needs at least 2 adults");
  assert.equal(partyProblem({ adults: 3, children: 0, infants: 0 }, { max_adults: 0 }, { maximum_adults: 2 }), "Up to 2 adults", "property limit applies too");
  assert.equal(partyProblem({ adults: 9, children: 9, infants: 9 }, { max_adults: 0, max_children: 0 }, {}), "", "0 means no limit");
});

test("the booking page sends the party and the address; the server prices and stores them", () => {
  const book = read("js/book.js");
  assert.match(book, /p_guests: guestsCount\(\), p_children: party\.children, p_infants: party\.infants,/);
  assert.match(book, /p_guest_address: addressMode === "off" \? null : address,/);
  assert.match(read("supabase/functions/create-booking/index.ts"), /"p_children", "p_infants", "p_guest_address"\]/);
  const sql = read("supabase/migrations/20261125000000_guest_party_address.sql");
  assert.match(sql, /v_per_night := v_extra_adults \* v_extra_rate \+ v_extra_children \* v_child_rate \+ v_extra_infants \* v_infant_rate;/);
  assert.match(sql, /v_extra_person := round\(v_per_night \* v_n, 2\);/);
  assert.doesNotMatch(sql, /v_extra_person := round\(v_extra_rate \* v_n, 2\);/, "the one-rate-per-night bug is gone");
  assert.match(sql, /check \(guest_address_mode in \('off', 'optional', 'required'\)\)/);
  assert.match(sql, /raise exception 'address_required'/);
  assert.match(sql, /grant select \(guest_address_mode, maximum_adults, maximum_children, maximum_infants\) on public\.tenants to anon;/);
  assert.match(read("js/reservation.js"), /p_infants: Math\.max\(0, parseInt\(f\.infants, 10\) \|\| 0\),\s+p_addon_ids/, "the editor prices infants too");
});

test("the party picker and address form are labelled and per property", () => {
  const html = read("book.html");
  for (const who of ["adults", "children", "infants"]) assert.match(html, new RegExp(`data-who="${who}" role="group" aria-labelledby="gp`));
  assert.match(html, /<button type="button" class="bk-guests-btn" id="guestsBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="guestsPop" hidden>/);
  for (const [id, ac] of [["gAddr1", "address-line1"], ["gCity", "address-level2"], ["gPostcode", "postal-code"], ["gCountry", "country-name"]]) {
    assert.match(html, new RegExp(`id="${id}" autocomplete="${ac}"`), id);
  }
  const app = read("app.html");
  assert.match(app, /<select class="select" id="bkAddressMode"><option value="off">Don't ask<\/option><option value="optional">Ask, optional<\/option><option value="required">Require it<\/option><\/select>/);
});
