// Focused test: one login on several properties.
// Risk covered: the dashboard opened an arbitrary membership (limit=1, no
// order) with no way to reach the others, and invites were only claimed by
// people with no property yet, so an existing user invited elsewhere never
// joined. Now the property in use is remembered per browser (the oldest
// membership otherwise), the sidebar picker lists and switches properties,
// and invites are claimed by members too.
// Run: node --test tests/multi-property.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const html = read("app.html");
const accept = read("supabase/functions/accept-invite/index.ts");
const sendEmail = read("supabase/functions/send-email/index.ts");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NAMES = { [A]: "Pinecrest Cabins", [B]: "Lakeside Inn" };
const calls = [];

globalThis.window = { SH_CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key" } };
const store = { sh_access_token: "user-jwt" };
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push(u);
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  if (u.includes("/auth/v1/user")) return json({ id: "user-1", email: "sam@example.com" });
  if (u.includes("/rest/v1/tenant_members?user_id=")) {
    return json([{ tenant_id: A, role: "owner", created_at: "2026-01-01" }, { tenant_id: B, role: "cleaner", created_at: "2026-05-01" }]);
  }
  if (u.includes("/rest/v1/rpc/member_tenant")) {
    const id = JSON.parse(opts.body).p_tenant;
    return json({ id, name: NAMES[id], slug: id === A ? "pinecrest" : "lakeside" });
  }
  if (u.includes("/rest/v1/tenants?id=in.")) return json([{ id: A, name: NAMES[A] }, { id: B, name: NAMES[B] }]);
  return json([]);
};

eval(read("js/db.js"));

test("without a remembered property, the oldest membership opens", async () => {
  delete store.sh_tenant;
  const live = await window.SHDB.loadLiveData();
  assert.equal(live.tenant.id, A);
  assert.equal(live.role, "owner");
  assert.deepEqual(live.memberships, [
    { id: A, role: "owner", name: "Pinecrest Cabins" },
    { id: B, role: "cleaner", name: "Lakeside Inn" }
  ]);
  assert.ok(calls.some((u) => u.includes("tenant_members?user_id=eq.user-1&select=tenant_id,role,created_at&order=created_at.asc")), "ordered, not limit=1");
});

test("the remembered property opens, with that property's role", async () => {
  window.SHDB.rememberTenant(B);
  assert.equal(store.sh_tenant, B);
  const live = await window.SHDB.loadLiveData();
  assert.equal(live.tenant.id, B);
  assert.equal(live.role, "cleaner", "role comes from the chosen membership, not the first");
  assert.ok(calls.some((u) => u.includes("/rest/v1/rooms?tenant_id=eq." + B)), "data loads for the chosen property");
});

test("a remembered property they no longer belong to falls back to the oldest", async () => {
  window.SHDB.rememberTenant("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  const live = await window.SHDB.loadLiveData();
  assert.equal(live.tenant.id, A);
});

test("the sidebar picker opens the property menu: switch, settings, add", () => {
  assert.match(html, /<button class="prop-picker" id="propPicker" type="button" aria-label="Your properties: switch or add a property">/);
  assert.match(app, /if \(window\.SHDB && SHDB\.hasLive\(\)\) openPropertySwitcher\(\); else goto\("settings"\);/);
  assert.match(app, /data-action="switch-property" data-id="\$\{esc\(p\.id\)\}"/);
  assert.match(app, /a === "switch-property"\) \{\s+const id = el\.dataset\.id;\s+if \(!id \|\| id === \(liveTenant && liveTenant\.id\)\) \{ closeModal\(\); return; \}\s+SHDB\.rememberTenant\(id\);\s+location\.reload\(\);/);
  assert.match(app, /a === "add-property"\) openPropertySetup\(true\);/);
  assert.match(app, /canSee\("settings"\) \? `<button class="btn btn-ghost btn-sm" type="button" data-action="property-settings">/);
  assert.match(app, /liveProperties = live\.memberships \|\| \[\];/);
});

test("a new property opens after creation (and after trial checkout)", () => {
  assert.match(app, /const switching = !!\(liveTenant && liveTenant\.id\);\s+\/\/ adding a second property\s+SHDB\.rememberTenant\(tenant\.id\);/);
});

test("people who already have a property still claim invites", () => {
  assert.match(app, /showFlash\(\);\s+claimInviteAsMember\(\);/, "runs after a property loads");
  assert.match(app, /if \(!token && checked\) return;/, "email-only check once per browser session");
  assert.match(app, /if \(token\) \{ openJoined\(d\); return; \}/, "following an invite link opens that property");
  assert.match(app, /tryClaimInvite\(\)\.then\(\(d\) => \{ if \(d\) openJoined\(d\); else openPropertySetup\(\); \}\);/);
  assert.match(app, /forget\(\); \/\/ joined, or the link's invite is used up or expired/);
  assert.match(app, /\/was sent to\/i\.test/, "the wrong-account message is shown");
});

test("accept-invite joins every pending invite for the email, never changing a role", () => {
  assert.match(accept, /\.order\("created_at", \{ ascending: false \}\)\.limit\(20\);/);
  assert.match(accept, /for \(const invite of invites\) \{\s+const tenant = await join\(invite, user\.id\);/);
  assert.match(accept, /return json\(\{ joined: true, role: tenants\[0\]\.role, tenant: tenants\[0\], tenants \}\);/);
  assert.match(accept, /ignoreDuplicates: true \}\); \/\/ never change an existing member's role/);
  assert.match(accept, /Sign out and log in \(or sign up\) with that email to accept it\./);
});

test("the invite email speaks to people who already have an account", () => {
  assert.match(sendEmail, /Already have an account with this email\? Log in and \$\{esc\(tenant\.name\)\} is added to it\./);
});
