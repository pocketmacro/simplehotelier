// Focused test: live-write persistence payloads in js/db.js (no network, no Supabase).
// Run: node --test tests/db-writes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = [];
const tenantId = "11111111-1111-1111-1111-111111111111";
const roomId = "21111111-1111-1111-1111-111111111111";

globalThis.window = {
  SH_CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key", TENANT_SLUG: "pinecrest" }
};
const store = { sh_access_token: "user-jwt" };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  if (u.includes("/auth/v1/user")) return json({ id: "user-1", email: "owner@example.com" });
  if (u.includes("/rest/v1/tenant_members")) return json([{ tenant_id: tenantId }]);
  if (u.includes("/rest/v1/rpc/member_tenant")) return json({ id: tenantId, name: "Pinecrest Cabins", slug: "pinecrest" });
  if (u.includes("/rest/v1/tenants?")) return json([{ id: tenantId, name: "Pinecrest Cabins", slug: "pinecrest" }]);
  if (u.includes("/rest/v1/rooms?")) return json([{ id: roomId, tenant_id: tenantId, code: "A1", name: "Aspen Loft", sleeps: 4, rate_cents: 18900, status: "vacant", housekeeping_status: "clean", notes: "" }]);
  if (u.includes("/rest/v1/reservations?")) return json([]);
  if (u.includes("/rest/v1/addons?")) return json([]);
  if (u.includes("/rest/v1/tax_rules?")) return json([]);
  if (u.includes("/rest/v1/transactions?")) return json([]);
  if (u.includes("/rest/v1/room_types") && opts.method === "POST") return json([{ id: "type-2" }], 201);
  if (u.includes("/rest/v1/room_types") && opts.method === "PATCH") return json([{ id: "type-1" }]);
  if (u.includes("/rest/v1/room_types?")) return json([{ id: "type-1", tenant_id: tenantId, name: "Cabin", description: "Standalone", bathrooms: 1.5, view: "Mountain view", smoking_policy: "non-smoking", min_stay: 2, max_stay: 14, rack_rate_cents: 24900, extra_adult_cents: 2500, extra_child_cents: 1000, extra_infant_cents: 0, included_adults: 2, included_children: 0, included_infants: 0, max_adults: 4, max_children: 2, max_infants: 1, max_occupants: 6, adults_required: 1, beds: [{ qty: 1, type: "Queen" }], handicap_accessible: true, accessible_features: ["Step-free entry"], features: ["Hot tub"], photos: ["https://example.com/y.jpg"], rate_plans: [{ id: "plan-1", name: "Extended stay rate", minStay: 3, maxStay: 30, rateKind: "percent", difference: -10, promoCode: "" }] }]);
  if (u.includes("/rest/v1/reservations") && opts.method === "POST") return json([{ id: "res-1", confirmation_code: opts.body ? JSON.parse(opts.body).confirmation_code : null }], 201);
  if (u.includes("/rest/v1/addons") && opts.method === "POST") return json([{ id: "addon-1" }], 201);
  return json([], 200);
};

eval(readFileSync(new URL("../js/db.js", import.meta.url), "utf8"));

test("createReservation posts a tenant-scoped payload with room UUID and cents", async () => {
  const live = await window.SHDB.loadLiveData();
  assert.equal(live.tenant.id, tenantId);
  assert.equal(typeof window.SHDB.createReservation, "function", "SHDB.createReservation must exist");
  const created = await window.SHDB.createReservation({
    ref: "R-2001", guestName: "Test Guest", contact: "guest@example.com", roomCode: "A1",
    checkIn: "2026-11-01", checkOut: "2026-11-03", status: "confirmed", source: "direct",
    subtotalCents: 37800, taxCents: 3024, totalCents: 40824, paidCents: 0
  });
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/reservations"));
  assert.ok(post, "expected a POST to reservations");
  assert.equal(post.body.tenant_id, tenantId);
  assert.equal(post.body.room_id, roomId);
  assert.equal(post.body.guest_email, "guest@example.com");
  assert.equal(post.body.total_cents, 40824);
  assert.equal(created.id, "res-1");
});

test("room type details map cents and JSONB lists on load", async () => {
  const live = await window.SHDB.loadLiveData();
  const t = live.roomTypes[0];
  assert.equal(t.name, "Cabin");
  assert.equal(t.bathrooms, 1.5);
  assert.equal(t.view, "Mountain view");
  assert.equal(t.rackRate, 249);
  assert.equal(t.extraAdultRate, 25);
  assert.equal(t.includedAdults, 2);
  assert.equal(t.maxOccupants, 6);
  assert.deepEqual(t.beds, [{ qty: 1, type: "Queen" }]);
  assert.equal(t.handicapAccessible, true);
  assert.deepEqual(t.features, ["Hot tub"]);
  assert.deepEqual(t.photos, ["https://example.com/y.jpg"]);
  assert.equal(t.ratePlans.length, 1);
  assert.equal(t.ratePlans[0].name, "Extended stay rate");
  assert.equal(t.ratePlans[0].difference, -10);
});

test("createRoomType posts full detail payload in cents", async () => {
  await window.SHDB.createRoomType({
    name: "Loft", desc: "Upper loft", bathrooms: 1, view: "City view", smoking: "non-smoking",
    minStay: 1, maxStay: 0, rackRate: 300, extraAdultRate: 30, extraChildRate: 15, extraInfantRate: 5,
    includedAdults: 2, includedChildren: 1, includedInfants: 0,
    maxAdults: 3, maxChildren: 2, maxInfants: 1, maxOccupants: 5, adultsRequired: 1,
    beds: [{ qty: 1, type: "King" }, { qty: 2, type: "Twin" }],
    handicapAccessible: false, accessibleFeatures: [], features: ["Air conditioning"], photos: [],
    ratePlans: [{ id: "plan-9", name: "Extended stay rate", minStay: 3, maxStay: 30, rateKind: "percent", difference: -10, promoCode: "STAYLONGER" }]
  });
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/room_types"));
  assert.ok(post, "expected a POST to room_types");
  assert.equal(post.body.tenant_id, tenantId);
  assert.equal(post.body.rack_rate_cents, 30000);
  assert.equal(post.body.extra_infant_cents, 500);
  assert.equal(post.body.included_adults, 2);
  assert.equal(post.body.max_occupants, 5);
  assert.deepEqual(post.body.beds, [{ qty: 1, type: "King" }, { qty: 2, type: "Twin" }]);
  assert.deepEqual(post.body.features, ["Air conditioning"]);
  assert.equal(post.body.rate_plans[0].promoCode, "STAYLONGER");
  assert.equal(post.body.rate_plans[0].difference, -10);
});

test("upsertRateOverrides sends rate, stay limits and stop-sell flags", async () => {
  await window.SHDB.upsertRateOverrides("type-1", [
    { date: "2026-12-24", rate: 449, minStay: 3, maxStay: null, closed: false, cta: true, ctd: false },
    { date: "2026-12-25", rate: 449, minStay: null, maxStay: 14, closed: true, cta: false, ctd: true }
  ]);
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/room_rate_overrides"));
  assert.ok(post, "expected a POST to room_rate_overrides");
  assert.equal(post.body[0].room_type_id, "type-1");
  assert.equal(post.body[0].rate_cents, 44900);
  assert.equal(post.body[0].min_stay, 3);
  assert.equal(post.body[0].max_stay, null);
  assert.equal(post.body[0].cta, true);
  assert.equal(post.body[1].closed, true);
  assert.equal(post.body[1].ctd, true);
  assert.equal(post.body[1].max_stay, 14);
});

test("createAddon converts dollars to cents and scopes to tenant", async () => {
  assert.equal(typeof window.SHDB.createAddon, "function", "SHDB.createAddon must exist");
  await window.SHDB.createAddon({ name: "Firewood bundle", desc: "Stacked at pit", price: 18.5, per: "stay" });
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/addons"));
  assert.ok(post, "expected a POST to addons");
  assert.equal(post.body.tenant_id, tenantId);
  assert.equal(post.body.price_cents, 1850);
});
