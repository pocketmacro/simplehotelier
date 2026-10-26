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
  if (u.includes("/rest/v1/tenants?")) return json([{ id: tenantId, name: "Pinecrest Cabins", slug: "pinecrest" }]);
  if (u.includes("/rest/v1/rooms?")) return json([{ id: roomId, tenant_id: tenantId, code: "A1", name: "Aspen Loft", sleeps: 4, rate_cents: 18900, status: "vacant", housekeeping_status: "clean", notes: "" }]);
  if (u.includes("/rest/v1/reservations?")) return json([]);
  if (u.includes("/rest/v1/addons?")) return json([]);
  if (u.includes("/rest/v1/tax_rules?")) return json([]);
  if (u.includes("/rest/v1/transactions?")) return json([]);
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

test("createAddon converts dollars to cents and scopes to tenant", async () => {
  assert.equal(typeof window.SHDB.createAddon, "function", "SHDB.createAddon must exist");
  await window.SHDB.createAddon({ name: "Firewood bundle", desc: "Stacked at pit", price: 18.5, per: "stay" });
  const post = calls.find((c) => c.method === "POST" && c.url.includes("/rest/v1/addons"));
  assert.ok(post, "expected a POST to addons");
  assert.equal(post.body.tenant_id, tenantId);
  assert.equal(post.body.price_cents, 1850);
});
