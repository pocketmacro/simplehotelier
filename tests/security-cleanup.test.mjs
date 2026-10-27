// Focused test: the last open review findings.
// Risks covered: (1) every member could read the calendar-export token and
// billing ids on tenants; (2) promo codes could be guessed without limit
// through get_rate_plans; (3) browsers kept default table privileges nothing
// uses (anon writes, TRUNCATE ...); (4) cleaners and maintenance could read
// every support case for the property. tests/rls/checks.sql R100-R103 prove
// these on the live database; this file guards the sources.
// Run: node --test tests/security-cleanup.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261123000000_security_cleanup.sql");
const db = read("js/db.js");
const auth = read("js/auth.js");
const app = read("js/app.js");

test("browsers can't read the calendar token or billing ids; managers get them from member_tenant", () => {
  assert.match(sql, /revoke select on public\.tenants from authenticated;/);
  assert.match(sql, /column_name not in \('ical_token', 'stripe_customer_id', 'stripe_subscription_id'\)/);
  assert.match(sql, /when public\.has_tenant_role\(t\.id, array\['owner', 'admin'\]\) then array\[\]::text\[\]\s+else array\['ical_token', 'stripe_customer_id', 'stripe_subscription_id'\] end/);
  assert.match(sql, /where t\.id = p_tenant and public\.is_tenant_member\(t\.id\)/);
  assert.match(sql, /revoke execute on function public\.member_tenant\(uuid\) from public, anon;/);
});

test("the dashboard never selects every tenants column", () => {
  assert.match(db, /rpc\("member_tenant", \{ p_tenant: mem\.tenant_id \}\)/);
  assert.match(db, /tenants\?select=id,name,slug,contact_email,subscription_status,current_period_end,created_at&order=/);
  assert.match(auth, /restInsert\("tenants\?select=id,name,slug,created_by,contact_email"/);
  // The only select=* on tenants is the fallback for a database without member_tenant().
  assert.match(db, /\.catch\(\(\) => rest\("tenants\?id=eq\." \+ mem\.tenant_id \+ "&select=\*"\)/);
  assert.doesNotMatch(db, /"tenants\?select=\*/);
  assert.match(app, /!ROLE_VIEWS\[liveRole\] && !live\.tenant\.stripe_customer_id/, "billing reminder is for owners/admins");
});

test("wrong promo codes are counted and capped per connection", () => {
  assert.match(sql, /create or replace function public\.get_rate_plans\(p_tenant uuid, p_promo text default null\)\s+returns table \(room_type_id uuid, rate_plans jsonb\)\s+language plpgsql volatile security definer/);
  assert.match(sql, /a\.created_at > now\(\) - interval '1 hour'\) >= 20 then\s+v_code := '';/);
  assert.match(sql, /insert into public\.promo_attempts \(ip_hash, tenant_id\) values \(v_hash, p_tenant\);/);
  assert.match(sql, /revoke all on public\.promo_attempts from anon, authenticated;/);
  assert.match(read("js/book.js"), /api\("rpc\/get_rate_plans", \{\s+method: "POST"/, "POST: a volatile function can't run in GET's read-only transaction");
});

test("browsers lose unused table privileges, now and for new tables", () => {
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on public\.%I from anon/);
  assert.match(sql, /revoke truncate, references, trigger on public\.%I from authenticated/);
  assert.match(sql, /alter default privileges for role postgres in schema public\s+revoke insert, update, delete, truncate, references, trigger on tables from anon;/);
});

test("support cases: front desk sees all, everyone else only their own", () => {
  assert.match(sql, /drop policy if exists cases_member_all on public\.support_cases;/);
  assert.match(sql, /or \(user_id = auth\.uid\(\) and public\.is_tenant_member\(tenant_id\)\)\);/);
  assert.match(sql, /with check \(public\.is_system_admin\(\)\s+or \(public\.is_tenant_member\(tenant_id\) and user_id = auth\.uid\(\)\)\);/);
  assert.match(sql, /using \(public\.is_system_admin\(\) or public\.can_see_support_case\(case_id\)\);/);
  assert.match(sql, /with check \(public\.is_system_admin\(\) or \(sender = 'user' and public\.can_see_support_case\(case_id\)\)\);/);
});
