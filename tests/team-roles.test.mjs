// Focused test: team roles inside a property.
// Risk covered: every member had full read/write on every property table, so
// a cleaner could read guest details, mark bookings paid, add payments or
// change prices, and staff could edit rates or set paid amounts directly.
// Now owner/admin manage everything, staff run the front desk, cleaners get
// housekeeping, the new maintenance role gets tickets, and payments only move
// through the logged payment functions. tests/rls/checks.sql (R95-R99)
// proves the database side against live; this file guards the sources.
// Run: node --test tests/team-roles.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261122000000_role_scoped_access.sql");
const app = read("js/app.js");
const db = read("js/db.js");
const css = read("css/app.css");
const appHtml = read("app.html");
const sendEmail = read("supabase/functions/send-email/index.ts");
const rlsChecks = read("tests/rls/checks.sql");

// ---------------------------------------------------------------- database
test("maintenance is a valid member and invite role", () => {
  for (const table of ["tenant_members", "invites"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} add constraint ${table}_role_check\\s+check \\(role in \\('owner', 'admin', 'staff', 'cleaner', 'maintenance'\\)\\)`), table);
  }
});

test("no table keeps the old any-member policy", () => {
  for (const name of ["transactions_member_all", "rooms_member_all", "maintenance_member_all", "invites_member_read"]) {
    assert.match(sql, new RegExp(`drop policy if exists ${name} on`), name);
  }
  // The loops drop <table>_member_all for the rest.
  assert.match(sql, /execute format\('drop policy if exists %I on public\.%I', t \|\| '_member_all', t\);/);
  assert.match(sql, /'reservations', 'guests', 'folio_entries', 'reservation_addons'/);
  assert.match(sql, /'room_types', 'addons', 'tax_rules', 'room_rate_overrides', 'ical_feeds'/);
  assert.match(sql, /when 'room_rate_overrides' then 'rate_overrides_member_all'/);
});

test("payments only move through the logged functions", () => {
  assert.match(sql, /create policy transactions_front_desk_read on public\.transactions for select to authenticated/);
  assert.doesNotMatch(sql, /on public\.transactions for (insert|update|delete|all)/);
  assert.match(sql, /new\.paid_cents is distinct from old\.paid_cents/);
  assert.match(sql, /raise exception 'payments_locked'/);
  assert.match(sql, /create trigger trg_reservations_money_guard before insert or update on public\.reservations/);
});

test("non-managers can only touch housekeeping fields on rooms", () => {
  assert.match(sql, /then array\['status', 'housekeeping_status', 'notes', 'updated_at'\]\s+else array\['housekeeping_status', 'notes', 'updated_at'\] end;/);
  assert.match(sql, /\(to_jsonb\(new\) - v_free\) is distinct from \(to_jsonb\(old\) - v_free\)/, "new columns are manager-only by default");
  assert.match(sql, /create policy rooms_team_update on public\.rooms for update to authenticated\s+using \(public\.has_tenant_role\(tenant_id, array\['owner', 'admin', 'staff', 'cleaner'\]\)\)/);
});

test("invite links are visible to owners and admins only", () => {
  assert.match(sql, /create policy invites_manager_read on public\.invites for select to authenticated\s+using \(public\.has_tenant_role\(tenant_id, array\['owner', 'admin'\]\)\)/);
});

test("the turnover list carries no guest details or money", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.housekeeping_turnovers"));
  assert.match(fn, /returns table \(room_id uuid, check_in date, check_out date, status text, adults int, children int, infants int\)/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("revoke")), /guest_|_cents|email|phone|notes/);
  assert.match(fn, /public\.has_tenant_role\(p_tenant, array\['owner', 'admin', 'staff', 'cleaner'\]\)/);
  assert.match(sql, /revoke execute on function public\.housekeeping_turnovers\(uuid, date, int\) from public, anon;/);
});

test("the live access-rule suite covers the roles and no longer accepts the gap", () => {
  for (const id of ["R95", "R96", "R97", "R98", "R99"]) assert.match(rlsChecks, new RegExp(`'${id} `), id);
  assert.doesNotMatch(rlsChecks, /KNOWN GAP/);
  assert.match(rlsChecks, /\(pg_temp\.id\('tenant_a'\), pg_temp\.id\('a_maint'\), 'maintenance'\)/);
});

// ---------------------------------------------------------------- dashboard
test("dashboard loads only what each role may see", () => {
  assert.match(db, /tenant_members\?user_id=eq\." \+ user\.id \+ "&select=tenant_id,role&limit=1"/);
  assert.match(db, /const desk = role === "owner" \|\| role === "admin" \|\| role === "staff";/);
  assert.match(db, /desk \? restAll\("reservations\?/);
  assert.match(db, /desk \? await restAll\("transactions\?/);
  assert.match(db, /role !== "maintenance" \? rpc\("housekeeping_turnovers"/);
});

// Run the real role table + guard from app.js.
const block = app.slice(app.indexOf("let liveRole ="), app.indexOf("let turnovers = [];"));
const roleEnv = new Function(block + "\nreturn { ROLE_VIEWS, ROLE_LABELS, setRole: (r) => { liveRole = r; }, canSee };")();

test("each role sees only its screens", () => {
  const { ROLE_VIEWS, setRole, canSee } = roleEnv;
  assert.deepEqual(ROLE_VIEWS.cleaner, ["housekeeping", "maintenance", "support"]);
  assert.deepEqual(ROLE_VIEWS.maintenance, ["maintenance", "support"]);
  for (const v of ["settings", "rates", "ratemgmt", "addons", "booking", "setup"]) {
    assert.ok(!ROLE_VIEWS.staff.includes(v), `staff must not see ${v}`);
  }
  for (const v of ["reservations", "payments", "housekeeping", "maintenance"]) assert.ok(ROLE_VIEWS.staff.includes(v), v);
  setRole("owner");
  assert.ok(canSee("settings") && canSee("rates"), "owners see everything");
  setRole("maintenance");
  assert.ok(canSee("maintenance") && !canSee("reservations") && !canSee("housekeeping"));
  setRole("cleaner");
  assert.ok(canSee("housekeeping") && !canSee("payments"));
});

test("navigation falls back to the role's home screen", () => {
  assert.match(app, /function goto\(view\) \{\s+if \(!canSee\(view\)\) view = ROLE_VIEWS\[liveRole\]\[0\];/);
  assert.match(app, /b\.hidden = !canSee\(b\.dataset\.view\);/);
  assert.match(app, /if \(!ROLE_VIEWS\[liveRole\] && computeSetup\(\)\.pct < 100\) goto\("setup"\);/, "only managers are sent to setup");
  assert.match(app, /\$\("#userRole"\)\.textContent = ROLE_LABELS\[liveRole\] \+ " · "/);
  assert.match(css, /body\[data-role\] :is\(\[data-action="add-room"\]/);
  assert.match(appHtml, /<div id="hkTurnovers"><\/div>/);
});

test("owners can invite maintenance staff", () => {
  assert.match(app, /<option value="maintenance">Maintenance — maintenance tickets only<\/option>/);
  assert.match(sendEmail, /\["admin", "staff", "cleaner", "maintenance"\]\.includes\(body\.role\)/);
});
