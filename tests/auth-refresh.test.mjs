// Focused test: expired access tokens are refreshed before writes (js/db.js).
// Regression: without refresh, saving a room type ~1h after login failed with
// "Supabase write failed" (PostgREST 401) while public reads kept working.
// Run: node --test tests/auth-refresh.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (expSeconds) => `${b64({ alg: "HS256" })}.${b64({ sub: "user-1", exp: expSeconds })}.sig`;
const EXPIRED = jwt(Math.floor(Date.now() / 1000) - 600);
const FRESH = jwt(Math.floor(Date.now() / 1000) + 3600);

const calls = [];
const store = { sh_access_token: EXPIRED, sh_refresh_token: "refresh-1" };
globalThis.window = { SH_CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key", TENANT_SLUG: "pinecrest" } };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const auth = (opts.headers && opts.headers.Authorization) || "";
  calls.push({ url: u, method: opts.method || "GET", auth });
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  if (u.includes("/auth/v1/token?grant_type=refresh_token")) return json({ access_token: FRESH, refresh_token: "refresh-2", user: { id: "user-1", email: "owner@example.com" } });
  if (u.includes("/auth/v1/user")) return json({ id: "user-1", email: "owner@example.com" });
  if (u.includes("/rest/v1/tenant_members")) return json([{ tenant_id: "t-1" }]);
  if (u.includes("/rest/v1/tenants?")) return json([{ id: "t-1", name: "Pinecrest", slug: "pinecrest" }]);
  if (u.includes("/rest/v1/room_types")) return json([]);
  return json([]);
};

eval(readFileSync(new URL("../js/db.js", import.meta.url), "utf8"));

test("expired token is refreshed before a room type save", async () => {
  await window.SHDB.loadLiveData(); // resolves member tenant via refreshed token
  await window.SHDB.updateRoomType("type-1", { name: "Cabin" });
  const refresh = calls.find((c) => c.url.includes("grant_type=refresh_token"));
  assert.ok(refresh, "expected a refresh-token exchange");
  const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/rest/v1/room_types"));
  assert.ok(patch, "expected the room type PATCH");
  assert.equal(patch.auth, "Bearer " + FRESH, "PATCH must carry the refreshed token, not the expired one");
  assert.equal(store.sh_access_token, FRESH, "new access token is stored");
  assert.equal(store.sh_refresh_token, "refresh-2", "rotated refresh token is stored");
});

test("still-valid token is used as-is (no refresh call)", async () => {
  calls.length = 0;
  store.sh_access_token = FRESH;
  await window.SHDB.freshToken();
  assert.equal(calls.filter((c) => c.url.includes("grant_type=refresh_token")).length, 0);
});
