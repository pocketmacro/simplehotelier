// Focused test: the demo must be isolated from real properties.
// Risks covered: (1) the dashboard anonymously loaded the real tenant named
// in config (TENANT_SLUG) and adopted its id, so demo/write actions targeted
// a real property and only RLS stood in the way; (2) demo data silently
// replaced a signed-in account's data when the live load failed; (3) the
// public booking page selected * on tenants, and anon could read every
// column (ical_token, Stripe customer/subscription ids, private emails).
// Run: node --test tests/demo-isolation.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const db = readFileSync(new URL("../js/db.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const auth = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
const book = readFileSync(new URL("../js/book.js", import.meta.url), "utf8");

// --- Behaviour: anonymous loadLiveData must not fetch any tenant by slug ---
const calls = [];
globalThis.window = { SH_CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key", TENANT_SLUG: "pinecrest" } };
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  return { ok: true, status: 200, json: async () => [{ id: "real-tenant", name: "Real Property", slug: "pinecrest", ical_token: "secret" }] };
};
eval(db);

test("anonymous dashboard load resolves no tenant and fetches no property data", async () => {
  const live = await window.SHDB.loadLiveData();
  assert.equal(live.tenant, null);
  assert.equal(live.user, null);
  assert.equal(window.SHDB.hasLive(), false, "anon/demo must never adopt a tenant id");
  assert.equal(calls.filter((u) => u.includes("tenants?slug=")).length, 0, "must not look up the config slug tenant");
  assert.equal(calls.filter((u) => u.includes("/rest/v1/")).length, 0, "must not query property tables anonymously");
});

// --- Source guards ---
test("db.js contains no anonymous slug-tenant fallback", () => {
  assert.doesNotMatch(db, /tenants\?slug=eq\./);
  assert.doesNotMatch(db, /TENANT_SLUG/);
});

test("demo is explicit opt-in via the demo button flag, never a silent fallback", () => {
  assert.match(auth, /sh_demo/);
  assert.match(app, /sh_demo/);
  // A failed live load for a configured backend clears data instead of
  // leaving the demo reservations/charges on a real account's screen.
  const failedBranch = app.slice(app.indexOf("if (!live)"), app.indexOf("if (!live.tenant)"));
  assert.match(failedBranch, /clearAllData\(\)/);
});

test("booking page never selects * on tenants and never requests secret columns", () => {
  const tenantLine = book.split("\n").find((l) => l.includes("tenants?slug="));
  assert.ok(tenantLine, "tenant-by-slug query not found");
  assert.ok(!tenantLine.includes("select=*"), "tenant query must list public columns explicitly");
  for (const secret of ["ical_token", "stripe_customer_id", "stripe_subscription_id", "tax_number", "booking_email"]) {
    assert.ok(!tenantLine.includes(secret), `public tenant select must not include ${secret}`);
  }
  const roomLine = book.split("\n").find((l) => l.includes('api("rooms?'));
  assert.ok(roomLine, "rooms query not found");
  assert.ok(!roomLine.includes("select=*"), "rooms query must list public columns explicitly");
  assert.ok(!roomLine.includes("notes"), "rooms query must not pull internal notes");
});

test("migration locks anon down to public columns and rotates leaked iCal tokens", () => {
  const path = new URL("../supabase/migrations/20261112000000_demo_lockdown.sql", import.meta.url);
  assert.ok(existsSync(path), "lockdown migration missing");
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /revoke select on public\.tenants from anon/);
  assert.match(sql, /grant select \([^)]*\) on public\.tenants to anon/);
  assert.ok(!/grant select \([^)]*ical_token/.test(sql), "ical_token must not be granted to anon");
  assert.ok(!/grant select \([^)]*stripe_customer_id/.test(sql), "stripe_customer_id must not be granted to anon");
  assert.match(sql, /revoke select on public\.rooms from anon/);
  assert.match(sql, /update public\.tenants\s+set ical_token =/);
});
