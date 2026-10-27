-- SimpleHotelier — database access rules (RLS, grants, guards) checked
-- against the LIVE database by scripts/rls-check.mjs.
-- Risks covered: cross-tenant reads and writes, membership takeover, billing
-- bypass on tenants, anonymous writes and promo-code leaks on the public
-- booking page, browsers calling internal (service-only) functions,
-- client-priced or unthrottled bookings, front-desk functions reachable by
-- cleaners or other tenants, team roles reaching data outside their job
-- (20261122000000_role_scoped_access), storage writes outside the tenant's folder,
-- support/invite impersonation, and new tables or SECURITY DEFINER functions
-- exposed by default.
--
-- Run: node scripts/rls-check.mjs   (never paste this into the SQL editor:
-- the runner appends the final raise that rolls everything back).
--
-- Rules for this file:
--  * It all runs as ONE transaction that the runner always rolls back. No
--    transaction control statements (the runner refuses them).
--  * Fixtures are created here with random ids (pg_temp.fx); nothing depends
--    on live rows. Fixed slugs/emails make a leaked earlier run fail loudly.
--  * Every case runs in its own subtransaction that is also rolled back, so
--    checks never see each other's writes.
--  * Check SQL refers to fixture ids as {key} placeholders (see pg_temp.fx).
--  * No jsonb question-mark operators (the Management API reads them as
--    placeholders).

-- ============================================================ results + fixture ids
create temp table rls_results (name text primary key, ok boolean not null, info text);
create temp table rls_meta as select txid_current() as txid;

create temp table fx (key text primary key, id uuid not null default gen_random_uuid());
insert into fx (key) values
  ('a_owner'), ('a_admin'), ('a_staff'), ('a_cleaner'), ('a_maint'), ('b_owner'), ('outsider'), ('claimer'),
  ('tenant_a'), ('tenant_b'), ('tenant_c'),
  ('type_a'), ('type_b'), ('room_a1'), ('room_a2'), ('room_b1'),
  ('addon_a'), ('tax_a'), ('override_a'), ('guest_a'), ('res_a'), ('res_b'), ('resaddon_a'),
  ('txn_a'), ('folio_a'), ('feed_a'), ('ticket_a'), ('invite_a'), ('case_a'), ('msg_a');

create function pg_temp.id(p_key text) returns uuid language sql stable as $f$
  select id from pg_temp.fx where key = p_key
$f$;

-- ============================================================ fixtures (as postgres)
-- auth.users has no triggers on this project; tenants_guard skips non-browser roles.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select f.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       replace(f.key, '_', '-') || '@rls-check.invalid', '', now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now()
from pg_temp.fx f
where f.key in ('a_owner', 'a_admin', 'a_staff', 'a_cleaner', 'a_maint', 'b_owner', 'outsider', 'claimer');

insert into public.tenants (id, name, slug, created_by, contact_email, booking_email, tax_number,
                            stripe_customer_id, ical_token)
values
  (pg_temp.id('tenant_a'), 'RLS Check A', 'rls-check-a', pg_temp.id('a_owner'), 'a@rls-check.invalid',
   'desk-a@rls-check.invalid', 'TAX-RLS-A', 'cus_rlscheck_a', md5('rls-a') || md5('rls-a-2')),
  (pg_temp.id('tenant_b'), 'RLS Check B', 'rls-check-b', pg_temp.id('b_owner'), 'b@rls-check.invalid',
   null, null, null, md5('rls-b') || md5('rls-b-2')),
  -- C: created by "claimer", no members yet (the signup bootstrap case).
  (pg_temp.id('tenant_c'), 'RLS Check C', 'rls-check-c', pg_temp.id('claimer'), null,
   null, null, null, md5('rls-c') || md5('rls-c-2'));

insert into public.tenant_members (tenant_id, user_id, role) values
  (pg_temp.id('tenant_a'), pg_temp.id('a_owner'), 'owner'),
  (pg_temp.id('tenant_a'), pg_temp.id('a_admin'), 'admin'),
  (pg_temp.id('tenant_a'), pg_temp.id('a_staff'), 'staff'),
  (pg_temp.id('tenant_a'), pg_temp.id('a_cleaner'), 'cleaner'),
  (pg_temp.id('tenant_a'), pg_temp.id('a_maint'), 'maintenance'),
  (pg_temp.id('tenant_b'), pg_temp.id('b_owner'), 'owner');

insert into public.room_types (id, tenant_id, name, rack_rate_cents, rate_plans) values
  (pg_temp.id('type_a'), pg_temp.id('tenant_a'), 'RLS Suite', 12000,
   '[{"id":"open","name":"Open Saver","rateKind":"percent","difference":-5},
     {"id":"coded","name":"Coded Deal","rateKind":"percent","difference":-20,"promoCode":"RLSCODE"}]'),
  (pg_temp.id('type_b'), pg_temp.id('tenant_b'), 'RLS Room B', 9000, '[]');

insert into public.rooms (id, tenant_id, room_type_id, code, name, notes, sort_order) values
  (pg_temp.id('room_a1'), pg_temp.id('tenant_a'), pg_temp.id('type_a'), 'A1', 'Suite A1', 'staff-only note', 1),
  (pg_temp.id('room_a2'), pg_temp.id('tenant_a'), pg_temp.id('type_a'), 'A2', 'Suite A2', null, 2),
  (pg_temp.id('room_b1'), pg_temp.id('tenant_b'), pg_temp.id('type_b'), 'B1', 'Room B1', null, 1);

insert into public.addons (id, tenant_id, name, price_cents, per) values
  (pg_temp.id('addon_a'), pg_temp.id('tenant_a'), 'Breakfast', 1500, 'stay');
insert into public.tax_rules (id, tenant_id, name, kind, rate) values
  (pg_temp.id('tax_a'), pg_temp.id('tenant_a'), 'City tax', 'percent', 10);
insert into public.room_rate_overrides (id, tenant_id, room_type_id, date, rate_cents) values
  (pg_temp.id('override_a'), pg_temp.id('tenant_a'), pg_temp.id('type_a'), current_date + 900, 15000);
insert into public.guests (id, tenant_id, name, email) values
  (pg_temp.id('guest_a'), pg_temp.id('tenant_a'), 'Grace Guest', 'grace@rls-check.invalid');

insert into public.reservations (id, tenant_id, room_id, guest_id, guest_name, guest_email, confirmation_code,
                                 check_in, check_out, status, source, subtotal_cents, total_cents, paid_cents)
values
  (pg_temp.id('res_a'), pg_temp.id('tenant_a'), pg_temp.id('room_a1'), pg_temp.id('guest_a'), 'Grace Guest',
   'grace@rls-check.invalid', 'RLS-A-0001', current_date + 100, current_date + 103, 'confirmed', 'direct', 36000, 36000, 0),
  (pg_temp.id('res_b'), pg_temp.id('tenant_b'), pg_temp.id('room_b1'), null, 'Bob Guest',
   'bob@rls-check.invalid', 'RLS-B-0001', current_date + 100, current_date + 102, 'confirmed', 'direct', 18000, 18000, 0);

insert into public.reservation_addons (id, tenant_id, reservation_id, addon_id, name_snapshot, price_cents, qty) values
  (pg_temp.id('resaddon_a'), pg_temp.id('tenant_a'), pg_temp.id('res_a'), pg_temp.id('addon_a'), 'Breakfast', 1500, 1);
insert into public.transactions (id, tenant_id, reservation_id, description, method, status, amount_cents,
                                 stripe_payment_intent_id, kind) values
  (pg_temp.id('txn_a'), pg_temp.id('tenant_a'), pg_temp.id('res_a'), 'RLS-A-0001 card', 'card', 'paid', 5000,
   'pi_rlscheck_a', 'charge');
insert into public.folio_entries (id, tenant_id, reservation_id, kind, description, amount_cents) values
  (pg_temp.id('folio_a'), pg_temp.id('tenant_a'), pg_temp.id('res_a'), 'room', 'Room charge', 36000);
insert into public.ical_feeds (id, tenant_id, room_id, name, url) values
  (pg_temp.id('feed_a'), pg_temp.id('tenant_a'), pg_temp.id('room_a1'), 'Airbnb', 'https://www.airbnb.com/calendar/ical/rls-check.ics');
insert into public.maintenance_tickets (id, tenant_id, room_id, title) values
  (pg_temp.id('ticket_a'), pg_temp.id('tenant_a'), pg_temp.id('room_a2'), 'Leaky tap');
insert into public.invites (id, tenant_id, email, role, invited_by) values
  (pg_temp.id('invite_a'), pg_temp.id('tenant_a'), 'new-hire@rls-check.invalid', 'staff', pg_temp.id('a_owner'));
insert into public.support_cases (id, tenant_id, user_id, requester_email, subject) values
  (pg_temp.id('case_a'), pg_temp.id('tenant_a'), pg_temp.id('a_owner'), 'a-owner@rls-check.invalid', 'Help with rates');
insert into public.support_messages (id, case_id, tenant_id, sender, body) values
  (pg_temp.id('msg_a'), pg_temp.id('case_a'), pg_temp.id('tenant_a'), 'user', 'How do I add a rate plan');
insert into storage.objects (bucket_id, name) values
  ('room-photos', pg_temp.id('tenant_a') || '/rls-check.jpg');

-- Tenant-scoped tables and how to pick tenant A's rows. private = not part
-- of the public booking page (anon must never read these).
create temp table member_tables (t text primary key, a_filter text not null, private boolean not null);
insert into member_tables values
  ('reservations',        $s$tenant_id = '{tenant_a}'$s$, true),
  ('guests',              $s$tenant_id = '{tenant_a}'$s$, true),
  ('transactions',        $s$tenant_id = '{tenant_a}'$s$, true),
  ('folio_entries',       $s$tenant_id = '{tenant_a}'$s$, true),
  ('reservation_addons',  $s$tenant_id = '{tenant_a}'$s$, true),
  ('tenant_members',      $s$tenant_id = '{tenant_a}'$s$, true),
  ('invites',             $s$tenant_id = '{tenant_a}'$s$, true),
  ('support_cases',       $s$tenant_id = '{tenant_a}'$s$, true),
  ('support_messages',    $s$case_id = '{case_a}'$s$, true),
  ('ical_feeds',          $s$tenant_id = '{tenant_a}'$s$, true),
  ('maintenance_tickets', $s$tenant_id = '{tenant_a}'$s$, true),
  ('tenants',             $s$id = '{tenant_a}'$s$, false),
  ('rooms',               $s$tenant_id = '{tenant_a}'$s$, false),
  ('room_types',          $s$tenant_id = '{tenant_a}'$s$, false),
  ('addons',              $s$tenant_id = '{tenant_a}'$s$, false),
  ('tax_rules',           $s$tenant_id = '{tenant_a}'$s$, false),
  ('room_rate_overrides', $s$tenant_id = '{tenant_a}'$s$, false);

-- ============================================================ helpers
create function pg_temp.rec(p_name text, p_ok boolean, p_info text) returns void language sql as $f$
  insert into pg_temp.rls_results (name, ok, info) values (p_name, coalesce(p_ok, false), left(p_info, 700))
$f$;

-- Replace {key} placeholders with fixture ids; unknown keys are a test bug.
create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare
  v text := p_sql;
  f record;
begin
  for f in select key, id from pg_temp.fx loop
    v := replace(v, '{' || f.key || '}', f.id::text);
  end loop;
  if v ~ '[{][a-z][a-z0-9_]*[}]' then
    raise exception 'unknown fixture placeholder in: %', left(v, 160);
  end if;
  return v;
end $f$;

-- Become a browser or server role for the rest of the current subtransaction.
-- p_who: 'anon', 'service' (service_role) or a fixture user key (authenticated).
create function pg_temp.act_as(p_who text) returns void language plpgsql as $f$
declare
  v_role text := case p_who when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end;
  v_uid uuid;
begin
  reset role;
  if v_role = 'authenticated' then
    v_uid := pg_temp.id(p_who);
    if v_uid is null then
      raise exception 'unknown fixture user %', p_who;
    end if;
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', v_role)::text, true);
  execute format('set local role %I', v_role);
end $f$;

-- Run p_setup as postgres, then p_sql as p_who, in a subtransaction that is
-- always rolled back. Returns rows returned/affected and the first row's
-- column "v" (if any), or the error's SQLSTATE and "message | detail".
create function pg_temp.try(p_who text, p_sql text, p_setup text default null,
                            out rows bigint, out val text, out state text, out msg text)
language plpgsql as $f$
declare
  v_sql text := pg_temp.sub(p_sql);
  v_setup text := pg_temp.sub(coalesce(p_setup, ''));
  v_n bigint;
  v_v text;
  v_detail text;
begin
  begin
    if v_setup <> '' then
      execute v_setup;
    end if;
    perform pg_temp.act_as(p_who);
    if v_sql ~* '^\s*(select|with)\s' then
      execute format('select count(*), min(to_jsonb(q) ->> %L) from (%s) q', 'v', v_sql) into v_n, v_v;
    else
      execute v_sql;
      get diagnostics v_n = row_count;
    end if;
    raise exception using errcode = 'RLS01', message = json_build_object('rows', v_n, 'val', v_v)::text;
  exception
    when sqlstate 'RLS01' then
      rows := (sqlerrm::json ->> 'rows')::bigint;
      val := sqlerrm::json ->> 'val';
    when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      state := sqlstate;
      msg := sqlerrm || coalesce(' | ' || nullif(v_detail, ''), '');
  end;
end $f$;

-- One named check: every (who, sql) pair must meet p_expect:
--   denied       42501 (no privilege / RLS refusal) or nothing returned/affected
--   rows=N       no error and exactly N rows; rows>=N at least N
--   error:XXXXX  that SQLSTATE, and p_msg (regex on "message | detail") if given
--   value~RE     no error and column v matches RE; value!~RE must not match
create function pg_temp.expect(p_name text, p_whos text[], p_sqls text[], p_expect text,
                               p_msg text default null, p_setup text default null)
returns void language plpgsql as $f$
declare
  w text;
  s text;
  r record;
  v_ok boolean;
  v_short text[] := '{}';
  v_bad text[] := '{}';
  v_info text;
begin
  if p_expect !~ '^(denied|rows=[0-9]+|rows>=[0-9]+|error:[0-9A-Z]{5}|value~.+|value!~.+)$' then
    raise exception 'check %: bad expectation %', p_name, p_expect;
  end if;
  if coalesce(cardinality(p_whos), 0) = 0 or coalesce(cardinality(p_sqls), 0) = 0 then
    raise exception 'check %: nothing to run', p_name;
  end if;
  foreach w in array p_whos loop
    foreach s in array p_sqls loop
      select * into r from pg_temp.try(w, s, p_setup);
      v_ok := coalesce(case
        when p_expect = 'denied' then r.state = '42501' or (r.state is null and r.rows = 0)
        when p_expect like 'rows>=%' then r.state is null and r.rows >= substr(p_expect, 7)::bigint
        when p_expect like 'rows=%' then r.state is null and r.rows = substr(p_expect, 6)::bigint
        when p_expect like 'error:%' then r.state = substr(p_expect, 7) and (p_msg is null or r.msg ~ p_msg)
        when p_expect like 'value!~%' then r.state is null and coalesce(r.val, '') !~ substr(p_expect, 8)
        else r.state is null and r.val ~ substr(p_expect, 7)
      end, false);
      v_short := v_short || case when r.state is null then 'rows=' || r.rows || coalesce(' v=' || left(r.val, 40), '')
                                 else r.state end;
      if not v_ok then
        v_bad := v_bad || format('%s: %s => %s', w, left(regexp_replace(s, '\s+', ' ', 'g'), 70),
          case when r.state is null then 'rows=' || r.rows || coalesce(' v=' || left(r.val, 80), '')
               else r.state || ' ' || left(r.msg, 120) end);
      end if;
    end loop;
  end loop;
  if cardinality(v_bad) = 0 then
    select format('%s case(s): %s', cardinality(v_short), string_agg(format('%s x%s', o, n), ', ' order by n desc, o))
      into v_info from (select o, count(*) as n from unnest(v_short) as o group by o) t;
  else
    v_info := format('%s of %s case(s) failed (expected %s): %s',
      cardinality(v_bad), cardinality(v_short), p_expect, array_to_string(v_bad, ' || '));
  end if;
  perform pg_temp.rec(p_name, cardinality(v_bad) = 0, v_info);
end $f$;

-- Custom DO-block checks end with pg_temp.verdict(); its raise rolls the
-- block back and the block's handler records it with pg_temp.caught().
create function pg_temp.verdict(p_ok boolean, p_info text) returns void language plpgsql as $f$
begin
  raise exception using errcode = 'RLS02',
    message = json_build_object('ok', coalesce(p_ok, false), 'info', p_info)::text;
end $f$;

create function pg_temp.caught(p_name text, p_state text, p_msg text) returns void language plpgsql as $f$
begin
  if p_state = 'RLS02' then
    perform pg_temp.rec(p_name, (p_msg::json ->> 'ok')::boolean, p_msg::json ->> 'info');
  else
    perform pg_temp.rec(p_name, false, format('unexpected %s: %s', p_state, p_msg));
  end if;
end $f$;

-- ============================================================ R01-R04 tenant isolation
select pg_temp.expect('R01 B owner reads none of tenant A''s rows (17 tables)',
  array['b_owner'],
  array(select format('select 1 from public.%I where %s', t, a_filter) from pg_temp.member_tables order by t),
  'denied');

-- Positive control for R01/R03/R30: the same reads do return A's fixtures to A's owner.
select pg_temp.expect('R02 A owner reads tenant A''s rows in all 17 tables (control)',
  array['a_owner'],
  array(select format('select 1 from public.%I where %s', t, a_filter) from pg_temp.member_tables order by t),
  'rows>=1');

-- No tenant filter: a user with no membership must see nothing, live rows included.
select pg_temp.expect('R03 outsider (no membership) reads no rows in any tenant table',
  array['outsider'],
  array(select format('select 1 from public.%I', t) from pg_temp.member_tables order by t),
  'denied');

select pg_temp.expect('R04 B owner cannot update, delete, insert or move rows into tenant A',
  array['b_owner'],
  array[
    $q$update public.reservations set guest_name = 'Hijacked' where id = '{res_a}'$q$,
    $q$update public.guests set email = 'x@rls-check.invalid' where id = '{guest_a}'$q$,
    $q$delete from public.rooms where id = '{room_a2}'$q$,
    $q$delete from public.transactions where id = '{txn_a}'$q$,
    $q$update public.tenants set name = 'Hijacked' where id = '{tenant_a}'$q$,
    $q$update public.room_types set rate_plans = '[]' where id = '{type_a}'$q$,
    $q$insert into public.guests (tenant_id, name) values ('{tenant_a}', 'Planted')$q$,
    $q$insert into public.reservations (tenant_id, room_id, guest_name, confirmation_code, check_in, check_out)
       values ('{tenant_a}', '{room_a2}', 'Planted', 'RLS-PLANT-1', current_date + 300, current_date + 301)$q$,
    $q$insert into public.transactions (tenant_id, description, amount_cents) values ('{tenant_a}', 'Planted', 100)$q$,
    $q$insert into public.addons (tenant_id, name) values ('{tenant_a}', 'Planted')$q$,
    $q$update public.reservations set tenant_id = '{tenant_a}' where id = '{res_b}'$q$
  ],
  'denied');

-- ============================================================ R10-R18 membership
select pg_temp.expect('R10 outsider and B owner cannot add themselves to tenant A',
  array['outsider', 'b_owner'],
  array[
    $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_a}', auth.uid(), 'owner')$q$,
    $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_a}', auth.uid(), 'staff')$q$,
    $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_a}', auth.uid(), 'cleaner')$q$
  ],
  'error:42501');

select pg_temp.expect('R11 staff and cleaner cannot change roles, add or remove members',
  array['a_staff', 'a_cleaner'],
  array[
    $q$update public.tenant_members set role = 'admin' where tenant_id = '{tenant_a}' and user_id = auth.uid()$q$,
    $q$update public.tenant_members set role = 'owner' where tenant_id = '{tenant_a}' and user_id = auth.uid()$q$,
    $q$update public.tenant_members set role = 'cleaner' where tenant_id = '{tenant_a}' and user_id = '{a_admin}'$q$,
    $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_a}', '{outsider}', 'staff')$q$,
    $q$delete from public.tenant_members where tenant_id = '{tenant_a}' and user_id = '{a_admin}'$q$
  ],
  'denied');

select pg_temp.expect('R12 admin cannot grant owner or demote/remove the owner',
  array['a_admin'],
  array[
    $q$update public.tenant_members set role = 'owner' where tenant_id = '{tenant_a}' and user_id = '{a_staff}'$q$,
    $q$update public.tenant_members set role = 'owner' where tenant_id = '{tenant_a}' and user_id = auth.uid()$q$,
    $q$update public.tenant_members set role = 'staff' where tenant_id = '{tenant_a}' and user_id = '{a_owner}'$q$,
    $q$delete from public.tenant_members where tenant_id = '{tenant_a}' and user_id = '{a_owner}'$q$
  ],
  'denied');

select pg_temp.expect('R13 owner and admin manage non-owner members (control)',
  array['a_owner', 'a_admin'],
  array[
    $q$update public.tenant_members set role = 'admin' where tenant_id = '{tenant_a}' and user_id = '{a_staff}'$q$,
    $q$delete from public.tenant_members where tenant_id = '{tenant_a}' and user_id = '{a_cleaner}'$q$
  ],
  'rows=1');

select pg_temp.expect('R14 creator claims ownership of their new memberless property (control)',
  array['claimer'],
  array[$q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_c}', auth.uid(), 'owner')$q$],
  'rows=1');

select pg_temp.expect('R15 nobody but the creator can claim a memberless property',
  array['outsider', 'b_owner'],
  array[
    $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_c}', auth.uid(), 'owner')$q$,
    $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_c}', auth.uid(), 'staff')$q$
  ],
  'error:42501');

select pg_temp.expect('R16 creator cannot claim again once the property has members',
  array['claimer'],
  array[$q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_c}', auth.uid(), 'owner')$q$],
  'error:42501',
  p_setup => $q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_c}', '{b_owner}', 'owner')$q$);

-- ============================================================ R20-R26 property settings + billing
select pg_temp.expect('R20 owner cannot change billing or account columns',
  array['a_owner'],
  array[
    $q$update public.tenants set subscription_status = 'active' where id = '{tenant_a}'$q$,
    $q$update public.tenants set plan_price_cents = 0 where id = '{tenant_a}'$q$,
    $q$update public.tenants set stripe_account_id = 'acct_rls_fake' where id = '{tenant_a}'$q$,
    $q$update public.tenants set stripe_onboarding_complete = true where id = '{tenant_a}'$q$,
    $q$update public.tenants set stripe_customer_id = 'cus_rls_other' where id = '{tenant_a}'$q$,
    $q$update public.tenants set current_period_end = now() + interval '10 years' where id = '{tenant_a}'$q$,
    $q$update public.tenants set created_by = '{outsider}' where id = '{tenant_a}'$q$
  ],
  'error:42501');

select pg_temp.expect('R21 owner and admin edit settings and a valid slug (control)',
  array['a_owner', 'a_admin'],
  array[
    $q$update public.tenants set name = 'RLS Check A Renamed' where id = '{tenant_a}'$q$,
    $q$update public.tenants set slug = 'rls-check-a-new' where id = '{tenant_a}'$q$,
    $q$update public.tenants set booking_theme = '{"font":"serif"}'::jsonb where id = '{tenant_a}'$q$
  ],
  'rows=1');

select pg_temp.expect('R22 staff and cleaner cannot edit property settings',
  array['a_staff', 'a_cleaner'],
  array[
    $q$update public.tenants set name = 'Staff Edit' where id = '{tenant_a}'$q$,
    $q$update public.tenants set booking_theme = '{"font":"serif"}'::jsonb where id = '{tenant_a}'$q$,
    $q$update public.tenants set rental_terms = 'Changed' where id = '{tenant_a}'$q$
  ],
  'denied');

select pg_temp.expect('R23 only the owner can delete the property',
  array['a_admin', 'a_staff', 'a_cleaner', 'b_owner'],
  array[$q$delete from public.tenants where id = '{tenant_a}'$q$],
  'denied');

select pg_temp.expect('R24 slug must be a lowercase DNS label and not reserved',
  array['a_owner'],
  array[
    $q$update public.tenants set slug = 'Bad Slug' where id = '{tenant_a}'$q$,
    $q$update public.tenants set slug = 'admin' where id = '{tenant_a}'$q$,
    $q$update public.tenants set slug = '-rls-check' where id = '{tenant_a}'$q$,
    $q$update public.tenants set slug = 'rls_check' where id = '{tenant_a}'$q$,
    $q$update public.tenants set slug = 'rls.check' where id = '{tenant_a}'$q$
  ],
  'error:22023');

do $$
declare
  v public.tenants%rowtype;
  v_id uuid;
  v_me uuid := pg_temp.id('outsider');
  v_other uuid := pg_temp.id('b_owner');
begin
  perform pg_temp.act_as('outsider');
  insert into public.tenants (name, slug, created_by, subscription_status, plan_price_cents, stripe_account_id,
                              stripe_onboarding_complete, stripe_customer_id, current_period_end, ical_token)
  values ('RLS Check New', 'rls-check-new', v_other, 'active', 0, 'acct_rls_fake', true, 'cus_rls_fake',
          now() + interval '10 years', 'short')
  returning id into v_id;  -- browsers can't read every column (R100); check as postgres
  reset role;
  select * into v from public.tenants where id = v_id;
  perform pg_temp.verdict(
    v.created_by = v_me and v.subscription_status = 'trialing' and v.plan_price_cents = 3000
      and v.stripe_account_id is null and not v.stripe_onboarding_complete and v.stripe_customer_id is null
      and v.current_period_end is null and char_length(v.ical_token) >= 32,
    format('created_by=%s status=%s price=%s acct=%s onboarded=%s token_len=%s',
      case when v.created_by = v_me then 'caller' else 'OTHER' end, v.subscription_status, v.plan_price_cents,
      coalesce(v.stripe_account_id, 'null'), v.stripe_onboarding_complete, char_length(v.ical_token)));
exception when others then
  perform pg_temp.caught('R25 a property created from the browser gets SimpleHotelier-set billing fields', sqlstate, sqlerrm);
end $$;

select pg_temp.expect('R26 booking_theme must be a small JSON object',
  array['a_owner'],
  array[
    $q$update public.tenants set booking_theme = '[]'::jsonb where id = '{tenant_a}'$q$,
    $q$update public.tenants set booking_theme = '"serif"'::jsonb where id = '{tenant_a}'$q$,
    $q$update public.tenants set booking_theme = (select jsonb_object_agg('k' || g, md5(g::text))
       from generate_series(1, 150) g) where id = '{tenant_a}'$q$
  ],
  'error:23514');

-- ============================================================ R30-R36 anonymous booking page
select pg_temp.expect('R30 anon reads none of the private tables',
  array['anon'],
  array(select format('select 1 from public.%I', t) from pg_temp.member_tables where private order by t),
  'denied');

select pg_temp.expect('R31 anon cannot insert reservations or reservation add-ons directly',
  array['anon'],
  array[
    $q$insert into public.reservations (tenant_id, room_id, guest_name, confirmation_code, check_in, check_out, status, total_cents, paid_cents)
       values ('{tenant_a}', '{room_a2}', 'Anon', 'RLS-ANON-1', current_date + 300, current_date + 301, 'pending', 1, 999999)$q$,
    $q$insert into public.reservation_addons (tenant_id, reservation_id, name_snapshot, price_cents)
       values ('{tenant_a}', '{res_a}', 'Free spa', 0)$q$
  ],
  'error:42501');

select pg_temp.expect('R32 anon cannot change public booking data',
  array['anon'],
  array[
    $q$update public.rooms set rate_cents = 0 where tenant_id = '{tenant_a}'$q$,
    $q$update public.tenants set name = 'Defaced' where id = '{tenant_a}'$q$,
    $q$update public.room_types set rack_rate_cents = 0 where tenant_id = '{tenant_a}'$q$,
    $q$update public.addons set price_cents = 0 where tenant_id = '{tenant_a}'$q$,
    $q$delete from public.tax_rules where tenant_id = '{tenant_a}'$q$,
    $q$insert into public.tenants (name, slug) values ('Anon Inn', 'rls-check-anon')$q$,
    $q$insert into public.room_rate_overrides (tenant_id, room_type_id, date, rate_cents)
       values ('{tenant_a}', '{type_a}', current_date + 901, 0)$q$
  ],
  'denied');

select pg_temp.expect('R33 anon cannot read private columns (rate plans, room notes, tenant secrets)',
  array['anon'],
  array[
    $q$select rate_plans from public.room_types where tenant_id = '{tenant_a}'$q$,
    $q$select notes from public.rooms where tenant_id = '{tenant_a}'$q$,
    $q$select housekeeping_status from public.rooms where tenant_id = '{tenant_a}'$q$,
    $q$select ical_token from public.tenants where id = '{tenant_a}'$q$,
    $q$select stripe_customer_id from public.tenants where id = '{tenant_a}'$q$,
    $q$select subscription_status from public.tenants where id = '{tenant_a}'$q$,
    $q$select tax_number from public.tenants where id = '{tenant_a}'$q$,
    $q$select booking_email from public.tenants where id = '{tenant_a}'$q$
  ],
  'error:42501');

select pg_temp.expect('R34 anon reads the public booking profile (control)',
  array['anon'],
  array[
    $q$select slug, name, brand_color, booking_theme from public.tenants where id = '{tenant_a}'$q$,
    $q$select id, name, rack_rate_cents from public.room_types where tenant_id = '{tenant_a}'$q$,
    $q$select id, code, rate_cents, photos from public.rooms where tenant_id = '{tenant_a}'$q$,
    $q$select id, name, price_cents from public.addons where tenant_id = '{tenant_a}'$q$,
    $q$select id, rate from public.tax_rules where tenant_id = '{tenant_a}'$q$,
    $q$select date, rate_cents from public.room_rate_overrides where tenant_id = '{tenant_a}'$q$
  ],
  'rows>=1');

select pg_temp.expect('R35 get_rate_plans hides promo-code plans without the right code',
  array['anon'],
  array[
    $q$select format('open=%s coded=%s', bool_or(rate_plans::text like '%Open Saver%'),
       bool_or(rate_plans::text like '%Coded%' or rate_plans::text like '%RLSCODE%')) as v
       from public.get_rate_plans('{tenant_a}')$q$,
    $q$select format('open=%s coded=%s', bool_or(rate_plans::text like '%Open Saver%'),
       bool_or(rate_plans::text like '%Coded%' or rate_plans::text like '%RLSCODE%')) as v
       from public.get_rate_plans('{tenant_a}', 'WRONGCODE')$q$
  ],
  'value~^open=t coded=f$');

select pg_temp.expect('R36 get_rate_plans reveals a promo plan for the right code (any case)',
  array['anon'],
  array[
    $q$select format('open=%s coded=%s', bool_or(rate_plans::text like '%Open Saver%'),
       bool_or(rate_plans::text like '%Coded Deal%')) as v from public.get_rate_plans('{tenant_a}', ' rlscode ')$q$
  ],
  'value~^open=t coded=t$');

-- ============================================================ R40-R49 internal functions + catalog
select pg_temp.expect('R40 quote_stay is refused to anon and signed-in users',
  array['anon', 'a_owner'],
  array[$q$select public.quote_stay('{tenant_a}'::uuid, '{room_a1}'::uuid, current_date + 10, current_date + 12, 2, '{}'::uuid[], null::text)$q$],
  'error:42501');

select pg_temp.expect('R41 record_stripe_payment (1-arg and 5-arg calls) is refused to browsers',
  array['anon', 'a_owner'],
  array[
    $q$select public.record_stripe_payment('pi_rlscheck_a')$q$,
    $q$select public.record_stripe_payment('pi_rls_new', '{res_a}'::uuid, 100000, 'Free money', 'charge')$q$
  ],
  'error:42501');

select pg_temp.expect('R42 record_stripe_refund is refused to browsers',
  array['anon', 'a_owner'],
  array[$q$select public.record_stripe_refund('re_rls_check', 'pi_rlscheck_a', 5000)$q$],
  'error:42501');

select pg_temp.expect('R43 bump_ai_usage is refused to browsers',
  array['anon', 'a_owner'],
  array[$q$select public.bump_ai_usage('{a_owner}'::uuid)$q$],
  'error:42501');

select pg_temp.expect('R44 create_booking is refused to browsers (Turnstile-gated function only)',
  array['anon', 'a_owner'],
  array[
    $q$select public.create_booking('{tenant_a}'::uuid, current_date + 20, current_date + 22, 'Bot', 'bot@rls-check.invalid',
       p_room_type => '{type_a}'::uuid)$q$,
    $q$select public.create_booking('{tenant_a}'::uuid, current_date + 20, current_date + 22, 'Bot', 'bot@rls-check.invalid',
       p_room_type => '{type_a}'::uuid, p_client_ip => '192.0.2.1')$q$
  ],
  'error:42501');

select pg_temp.expect('R45 release_abandoned_holds is refused to browsers',
  array['anon', 'a_owner'],
  array[
    $q$select public.release_abandoned_holds('{tenant_a}'::uuid)$q$,
    $q$select public.release_abandoned_holds()$q$
  ],
  'error:42501');

-- Catches a re-created or leftover overload (e.g. the old 14-arg
-- create_booking or 1-arg record_stripe_payment) that browsers could call.
select pg_temp.rec('R46 no overload of an internal function is executable by anon/authenticated',
  count(distinct p.proname) = 6 and count(*) filter (where x.exposed) = 0,
  format('%s overloads of %s functions; browser-executable: %s', count(*), count(distinct p.proname),
    coalesce(string_agg(p.oid::regprocedure::text, ', ') filter (where x.exposed), 'none')))
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select has_function_privilege('anon', p.oid, 'execute')
                        or has_function_privilege('authenticated', p.oid, 'execute') as exposed) x
where n.nspname = 'public'
  and p.proname in ('quote_stay', 'record_stripe_payment', 'record_stripe_refund', 'bump_ai_usage',
                    'create_booking', 'release_abandoned_holds');

-- Supabase grants EXECUTE on new functions to anon/authenticated by default,
-- so a new SECURITY DEFINER function is browser-callable unless revoked.
-- Adding one on purpose? Add it here after checking it guards itself.
with exposed as (
  select p.oid::regprocedure::text as fn, p.proname, r.rolname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) as r (rolname)
  where n.nspname = 'public' and p.prosecdef
    and p.prorettype not in ('trigger'::regtype::oid, 'event_trigger'::regtype::oid)
    and has_function_privilege(r.rolname, p.oid, 'execute')
), unexpected as (
  select * from exposed
  where not (proname = any (array['member_tenant_ids', 'is_tenant_member', 'has_tenant_role', 'can_claim_tenant',
                                  'is_system_admin', 'get_available_room_ids', 'get_rate_plans', 'log_client_error']))
    and not (rolname = 'authenticated' and proname = any (array['staff_quote', 'save_reservation', 'record_manual_payment',
                                                                'housekeeping_turnovers', 'member_tenant', 'can_see_support_case',
                                                                'team_members']))
)
select pg_temp.rec('R47 only allowlisted SECURITY DEFINER functions are browser-callable',
  (select count(*) from unexpected) = 0,
  format('%s exposed (role, function) pairs; unexpected: %s', (select count(*) from exposed),
    coalesce((select string_agg(rolname || ':' || fn, ', ') from unexpected), 'none')));

select pg_temp.expect('R48 service_role can run the internal functions (control)',
  array['service'],
  array[
    $q$select public.quote_stay('{tenant_a}'::uuid, '{room_a1}'::uuid, current_date + 10, current_date + 12, 2, '{}'::uuid[], null::text)$q$,
    $q$select public.record_stripe_payment('pi_rls_unknown')$q$,
    $q$select public.record_stripe_refund('re_rls_check', 'pi_rls_unknown', 100)$q$,
    $q$select public.bump_ai_usage('{a_owner}'::uuid)$q$,
    $q$select public.release_abandoned_holds('{tenant_a}'::uuid)$q$
  ],
  'rows=1');

-- A new table without RLS is readable and writable through PostgREST.
select pg_temp.rec('R49 every table in public has row level security enabled',
  count(*) > 0 and count(*) filter (where not c.relrowsecurity) = 0,
  format('%s tables; without RLS: %s', count(*),
    coalesce(string_agg(c.relname, ', ') filter (where not c.relrowsecurity), 'none')))
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p');

-- ============================================================ R50-R54 server-side booking
do $$
declare
  v_a uuid := pg_temp.id('tenant_a');
  v_type uuid := pg_temp.id('type_a');
  v_addon uuid := pg_temp.id('addon_a');
  v_rooms uuid[] := array[pg_temp.id('room_a1'), pg_temp.id('room_a2')];
  v jsonb;
  r public.reservations%rowtype;
  q jsonb;
  n_ip int;
  n_raw int;
  n_addon int;
begin
  perform pg_temp.act_as('service');
  v := public.create_booking(v_a, current_date + 30, current_date + 33, 'Rhea Guest', ' Rhea@RLS-check.invalid ',
         p_room_type => v_type, p_guests => 3, p_addon_ids => array[v_addon], p_client_ip => '198.51.100.23');
  reset role;
  select * into r from public.reservations where id = (v ->> 'reservation_id')::uuid;
  q := public.quote_stay(v_a, r.room_id, current_date + 30, current_date + 33, 3, array[v_addon], null);
  select count(*) into n_ip from public.booking_attempts
    where ip_hash = encode(sha256(convert_to('198.51.100.23', 'UTF8')), 'hex') and tenant_id = v_a;
  select count(*) into n_raw from public.booking_attempts where ip_hash like '%198.51.100.23%';
  select count(*) into n_addon from public.reservation_addons
    where reservation_id = r.id and tenant_id = v_a and addon_id = v_addon;
  perform pg_temp.verdict(
    r.tenant_id = v_a and r.room_id = any (v_rooms) and r.status = 'pending' and r.source = 'direct'
      and r.paid_cents = 0 and r.confirmation_code ~ '^SH-[A-HJ-NP-Z2-9]{6}$'
      and r.guest_email = 'rhea@rls-check.invalid' and r.total_cents > 0
      and r.total_cents = (q ->> 'total_cents')::int and n_ip = 1 and n_raw = 0 and n_addon = 1,
    format('status=%s paid=%s code=%s total=%s quote=%s ip_hash_rows=%s raw_ip_rows=%s addon_rows=%s',
      r.status, r.paid_cents, r.confirmation_code, r.total_cents, q ->> 'total_cents', n_ip, n_raw, n_addon));
exception when others then
  perform pg_temp.caught('R50 service booking is server-priced: pending, unpaid, SH- code, quote total, hashed IP', sqlstate, sqlerrm);
end $$;

select pg_temp.expect('R51 create_booking refuses another tenant''s room or room type',
  array['service'],
  array[
    $q$select public.create_booking('{tenant_a}'::uuid, current_date + 40, current_date + 42, 'Cross Guest',
       'cross@rls-check.invalid', p_room => '{room_b1}'::uuid)$q$,
    $q$select public.create_booking('{tenant_a}'::uuid, current_date + 40, current_date + 42, 'Cross Guest',
       'cross@rls-check.invalid', p_room_type => '{type_b}'::uuid)$q$
  ],
  'error:P0001', '^room_not_found ');

select pg_temp.expect('R52 per-email throttle: a 4th pending request in a day is refused',
  array['service'],
  array[$q$select public.create_booking('{tenant_a}'::uuid, current_date + 40, current_date + 42, 'Throttle Guest',
          'Throttle@RLS-check.invalid', p_room_type => '{type_a}'::uuid)$q$],
  'error:P0001', '^too_many_requests .*waiting with this property',
  p_setup => $q$insert into public.reservations (tenant_id, room_id, guest_name, guest_email, confirmation_code,
                  check_in, check_out, status, source)
                select '{tenant_a}', '{room_a2}', 'Throttle Guest', 'throttle@rls-check.invalid', 'RLS-T-' || g,
                       current_date + 200 + g * 2, current_date + 201 + g * 2, 'pending', 'direct'
                from generate_series(1, 3) g$q$);

select pg_temp.expect('R53 per-IP throttle (IP passed by the Edge Function): 11th booking in an hour refused',
  array['service'],
  array[$q$select public.create_booking('{tenant_a}'::uuid, current_date + 40, current_date + 42, 'Ip Guest',
          'ip-one@rls-check.invalid', p_room_type => '{type_a}'::uuid, p_client_ip => '203.0.113.7')$q$],
  'error:P0001', '^too_many_requests .*from this connection',
  p_setup => $q$insert into public.booking_attempts (ip_hash, tenant_id)
                select encode(sha256(convert_to('203.0.113.7', 'UTF8')), 'hex'), '{tenant_b}'
                from generate_series(1, 10)$q$);

do $$
declare
  v_a uuid := pg_temp.id('tenant_a');
  v_type uuid := pg_temp.id('type_a');
  v jsonb;
  v_arr text;
begin
  perform pg_temp.act_as('service');
  v := public.create_booking(v_a, current_date + 60, current_date + 62, 'Arrival Guest',
         'arrival@rls-check.invalid', p_room_type => v_type, p_client_ip => '203.0.113.55',
         p_arrival_time => '4 – 6 PM');
  reset role;
  select arrival_time into v_arr from public.reservations where id = (v ->> 'reservation_id')::uuid;
  perform pg_temp.verdict(v_arr = '4 – 6 PM', 'arrival_time=' || coalesce(v_arr, 'null'));
exception when others then
  perform pg_temp.caught('R55 guests can give an arrival window; it lands on the reservation', sqlstate, sqlerrm);
end $$;
select pg_temp.expect('R55b only the listed arrival windows are accepted',
  array['service'],
  array[$q$select public.create_booking('{tenant_a}'::uuid, current_date + 64, current_date + 66, 'Arrival Guest',
          'arrival2@rls-check.invalid', p_room_type => '{type_a}'::uuid, p_client_ip => '203.0.113.56',
          p_arrival_time => '<script>3am')$q$],
  'error:P0001', '^invalid_arrival_time ');

-- R56: party pricing and limits (20261125000000). type_a: extra adult $20,
-- child $10, infant $5 per night, 2 included places, at most 3 adults,
-- 2 children, 1 infant. quote_stay is internal, so this runs as postgres.
do $$
declare
  v_a uuid := pg_temp.id('tenant_a');
  v_room uuid := pg_temp.id('room_a1');
  d date := current_date + 200;
  q jsonb;
  got text := '';
  want text := 'legacy3=2000 legacy4=too_many_adults a2c1i1=1500 a1c2=1000 a3c1=3000 c3=too_many_children i2=too_many_infants a3x2n=4000 nochildrate_a2c2=4000';
  f text;
begin
  update public.room_types set extra_adult_cents = 2000, extra_child_cents = 1000, extra_infant_cents = 500, included_adults = 2,
    included_children = 0, included_infants = 0, max_adults = 3, max_children = 2, max_infants = 1, adults_required = 1, max_occupants = 0
  where id = pg_temp.id('type_a');
  for f in select unnest(array['legacy3', 'legacy4', 'a2c1i1', 'a1c2', 'a3c1', 'c3', 'i2', 'a3x2n', 'nochildrate_a2c2']) loop
    if f = 'nochildrate_a2c2' then update public.room_types set extra_child_cents = 0 where id = pg_temp.id('type_a'); end if;
    q := case f
      when 'legacy3' then public.quote_stay(v_a, v_room, d, d + 1, 3, '{}', null)
      when 'legacy4' then public.quote_stay(v_a, v_room, d, d + 1, 4, '{}', null)
      when 'a2c1i1' then public.quote_stay(v_a, v_room, d, d + 1, 3, '{}', null, p_children => 1, p_infants => 1)
      when 'a1c2' then public.quote_stay(v_a, v_room, d, d + 1, 3, '{}', null, p_children => 2)
      when 'a3c1' then public.quote_stay(v_a, v_room, d, d + 1, 4, '{}', null, p_children => 1)
      when 'c3' then public.quote_stay(v_a, v_room, d, d + 1, 4, '{}', null, p_children => 3)
      when 'i2' then public.quote_stay(v_a, v_room, d, d + 1, 2, '{}', null, p_children => 0, p_infants => 2)
      when 'a3x2n' then public.quote_stay(v_a, v_room, d, d + 2, 3, '{}', null, p_children => 0)
      else public.quote_stay(v_a, v_room, d, d + 1, 4, '{}', null, p_children => 2) end;
    got := got || case when got = '' then '' else ' ' end || f || '=' || coalesce(q ->> 'error', q ->> 'extra_person_cents');
  end loop;
  perform pg_temp.verdict(got = want, got);
exception when others then
  perform pg_temp.caught('R56 party pricing: per-person extras, child/infant rates, adult/child/infant limits', sqlstate, sqlerrm);
end $$;

-- R57: address modes and the party on the reservation (create_booking).
do $$
declare
  v_a uuid := pg_temp.id('tenant_a');
  v_type uuid := pg_temp.id('type_a');
  v jsonb;
  r public.reservations%rowtype;
  got text := '';
begin
  update public.tenants set guest_address_mode = 'required' where id = v_a;
  perform pg_temp.act_as('service');
  begin
    v := public.create_booking(v_a, current_date + 300, current_date + 302, 'Address Guest', 'addr1@rls-check.invalid',
           p_room_type => v_type, p_client_ip => '203.0.113.70');
    got := got || 'missing=booked';
  exception when others then
    got := got || 'missing=' || sqlerrm;
  end;
  v := public.create_booking(v_a, current_date + 304, current_date + 306, 'Address Guest', 'addr2@rls-check.invalid',
         p_room_type => v_type, p_client_ip => '203.0.113.71', p_guests => 3, p_children => 1, p_infants => 1,
         p_guest_address => '{"line1":"1 Pine Rd","city":"Valentine","state":"NE","postcode":"69201","country":"United States","evil":"x"}');
  reset role;
  select * into r from public.reservations where id = (v ->> 'reservation_id')::uuid;
  got := got || format(' stored=%s/%s/%s/%s party=%s+%s+%s', r.guest_address_line1, r.guest_city, r.guest_postcode, r.guest_country,
                       r.adults, r.children, r.infants);
  update public.tenants set guest_address_mode = 'off' where id = v_a;
  perform pg_temp.act_as('service');
  v := public.create_booking(v_a, current_date + 308, current_date + 310, 'Address Guest', 'addr3@rls-check.invalid',
         p_room_type => v_type, p_client_ip => '203.0.113.72', p_guest_address => '{"line1":"Ignored St","city":"X","postcode":"1","country":"Y"}');
  reset role;
  select * into r from public.reservations where id = (v ->> 'reservation_id')::uuid;
  got := got || ' off=' || coalesce(r.guest_address_line1, 'null');
  perform pg_temp.verdict(got = 'missing=address_required stored=1 Pine Rd/Valentine/69201/United States party=2+1+1 off=null', got);
exception when others then
  perform pg_temp.caught('R57 address modes (off/required) and adults/children/infants stored on the booking', sqlstate, sqlerrm);
end $$;

select pg_temp.expect('R54 per-IP throttle (cf-connecting-ip request header) refuses the 11th booking',
  array['service'],
  array[$q$select public.create_booking('{tenant_a}'::uuid, current_date + 40, current_date + 42, 'Ip Guest',
          'ip-two@rls-check.invalid', p_room_type => '{type_a}'::uuid)$q$],
  'error:P0001', '^too_many_requests .*from this connection',
  p_setup => $q$with h as (select set_config('request.headers', '{"cf-connecting-ip":"203.0.113.8"}', true))
                insert into public.booking_attempts (ip_hash, tenant_id)
                select encode(sha256(convert_to('203.0.113.8', 'UTF8')), 'hex'), '{tenant_b}'
                from generate_series(1, 10), h$q$);

-- ============================================================ R60-R65 front-desk functions
select pg_temp.expect('R60 save_reservation works for owner, admin and staff (control)',
  array['a_owner', 'a_admin', 'a_staff'],
  array[$q$select public.save_reservation('{tenant_a}', null, '{room_a2}', current_date + 60, current_date + 62,
          '{"name":"Desk Guest","email":"desk@rls-check.invalid"}'::jsonb) ->> 'confirmation_code' as v$q$],
  'value~^R-[A-HJ-NP-Z2-9]{6}$');

select pg_temp.expect('R61 save_reservation is refused to cleaners, other tenants and anon',
  array['a_cleaner', 'b_owner', 'anon'],
  array[$q$select public.save_reservation('{tenant_a}', null, '{room_a2}', current_date + 60, current_date + 62,
          '{"name":"Desk Guest"}'::jsonb)$q$],
  'error:42501');

select pg_temp.expect('R62 save_reservation cannot reach another tenant''s room or booking',
  array['b_owner'],
  array[
    $q$select public.save_reservation('{tenant_b}', null, '{room_a1}', current_date + 60, current_date + 62,
       '{"name":"Cross Guest"}'::jsonb)$q$,
    $q$select public.save_reservation('{tenant_b}', '{res_a}', '{room_b1}', current_date + 60, current_date + 62,
       '{"name":"Cross Guest"}'::jsonb)$q$
  ],
  'error:P0001', '^(room_not_found|not_found) ');

select pg_temp.expect('R63 record_manual_payment works for owner, admin and staff (control)',
  array['a_owner', 'a_admin', 'a_staff'],
  array[$q$select public.record_manual_payment('{res_a}', 2500, 'Cash') ->> 'paid_cents' as v$q$],
  'value~^2500$');

select pg_temp.expect('R64 record_manual_payment is refused to cleaners, other tenants and anon',
  array['a_cleaner', 'b_owner', 'anon'],
  array[$q$select public.record_manual_payment('{res_a}', 2500, 'Cash')$q$],
  'error:42501');

select pg_temp.expect('R65 staff_quote is refused to cleaners, other tenants and anon',
  array['a_cleaner', 'b_owner', 'anon'],
  array[$q$select public.staff_quote('{tenant_a}', '{room_a1}', current_date + 10, current_date + 12)$q$],
  'error:42501');

-- ============================================================ R70-R72 storage
-- storage.objects refuses every direct DELETE unless storage.allow_delete_query
-- is on (the Storage API sets it), so the delete cases set it to reach the policy.
select pg_temp.expect('R70 members upload, update and delete inside their tenant folder (control)',
  array['a_owner', 'a_staff'],
  array[
    $q$insert into storage.objects (bucket_id, name) values ('room-photos', '{tenant_a}/rls-new.jpg')$q$,
    $q$insert into storage.objects (bucket_id, name) values ('property-logos', '{tenant_a}/logo.png')$q$,
    $q$update storage.objects set metadata = '{"size":1}'::jsonb
       where bucket_id = 'room-photos' and name = '{tenant_a}/rls-check.jpg'$q$,
    $q$delete from storage.objects where bucket_id = 'room-photos' and name = '{tenant_a}/rls-check.jpg'$q$
  ],
  'rows=1',
  p_setup => $q$select set_config('storage.allow_delete_query', 'true', true)$q$);

select pg_temp.expect('R71 uploads outside the caller''s tenant folder are refused',
  array['a_owner', 'anon'],
  array[
    $q$insert into storage.objects (bucket_id, name) values ('room-photos', '{tenant_b}/planted.jpg')$q$,
    $q$insert into storage.objects (bucket_id, name) values ('property-logos', '{tenant_b}/logo.png')$q$,
    $q$insert into storage.objects (bucket_id, name) values ('room-photos', 'planted-at-root.jpg')$q$,
    $q$insert into storage.objects (bucket_id, name) values ('room-photos', 'shared/{tenant_a}/x.jpg')$q$,
    $q$update storage.objects set name = '{tenant_b}/moved.jpg'
       where bucket_id = 'room-photos' and name = '{tenant_a}/rls-check.jpg'$q$
  ],
  'denied');

select pg_temp.expect('R72 other tenants cannot overwrite, move or delete A''s files',
  array['b_owner', 'outsider', 'anon'],
  array[
    $q$update storage.objects set metadata = '{"defaced":true}'::jsonb
       where bucket_id = 'room-photos' and name = '{tenant_a}/rls-check.jpg'$q$,
    $q$update storage.objects set name = '{tenant_b}/stolen.jpg'
       where bucket_id = 'room-photos' and name = '{tenant_a}/rls-check.jpg'$q$,
    $q$delete from storage.objects where bucket_id = 'room-photos' and name = '{tenant_a}/rls-check.jpg'$q$
  ],
  'denied',
  p_setup => $q$select set_config('storage.allow_delete_query', 'true', true)$q$);

-- ============================================================ R80-R85 support + invites
select pg_temp.expect('R80 members post support messages as the user (control)',
  array['a_owner', 'a_staff'],
  array[$q$insert into public.support_messages (case_id, tenant_id, sender, body)
          values ('{case_a}', '{tenant_a}', 'user', 'Thanks')$q$],
  'rows=1');

select pg_temp.expect('R81 members cannot post as admin/ai/system or edit/delete messages',
  array['a_owner', 'a_staff'],
  array[
    $q$insert into public.support_messages (case_id, tenant_id, sender, body) values ('{case_a}', '{tenant_a}', 'admin', 'Refund approved')$q$,
    $q$insert into public.support_messages (case_id, tenant_id, sender, body) values ('{case_a}', '{tenant_a}', 'ai', 'Fake answer')$q$,
    $q$insert into public.support_messages (case_id, tenant_id, sender, body) values ('{case_a}', '{tenant_a}', 'system', 'Fake notice')$q$,
    $q$update public.support_messages set body = 'Edited' where id = '{msg_a}'$q$,
    $q$delete from public.support_messages where id = '{msg_a}'$q$
  ],
  'denied');

select pg_temp.expect('R82 other tenants cannot post into A''s support case or open one for A',
  array['b_owner', 'outsider'],
  array[
    $q$insert into public.support_messages (case_id, tenant_id, sender, body) values ('{case_a}', '{tenant_a}', 'user', 'Injected')$q$,
    $q$insert into public.support_cases (tenant_id, subject) values ('{tenant_a}', 'Injected case')$q$
  ],
  'denied');

select pg_temp.expect('R83 invites cannot be inserted directly (accept-invite/send-email only)',
  array['a_owner', 'a_admin'],
  array[$q$insert into public.invites (tenant_id, email, role) values ('{tenant_a}', 'mallory@rls-check.invalid', 'owner')$q$],
  'error:42501');

select pg_temp.expect('R84 staff, cleaners and other tenants cannot revoke or edit invites',
  array['a_staff', 'a_cleaner', 'b_owner'],
  array[
    $q$delete from public.invites where id = '{invite_a}'$q$,
    $q$update public.invites set role = 'owner' where id = '{invite_a}'$q$
  ],
  'denied');

select pg_temp.expect('R85 owner and admin can revoke invites (control)',
  array['a_owner', 'a_admin'],
  array[$q$delete from public.invites where id = '{invite_a}'$q$],
  'rows=1');

-- ============================================================ R90-R92 service-only data + data guards
select pg_temp.expect('R90 browsers cannot read service-only tables',
  array['anon', 'a_owner'],
  array[
    $q$select 1 from public.booking_attempts$q$,
    $q$select 1 from public.ai_usage$q$,
    $q$select 1 from public.system_config$q$
  ],
  'denied');

select pg_temp.expect('R91 nobody can make themselves a system admin',
  array['outsider', 'a_owner'],
  array[$q$insert into public.system_admins (user_id) values (auth.uid())$q$],
  'error:42501');

select pg_temp.expect('R92 data guards: safe confirmation codes, https-only iCal feeds',
  array['a_owner'],
  array[
    $q$insert into public.reservations (tenant_id, room_id, guest_name, confirmation_code, check_in, check_out)
       values ('{tenant_a}', '{room_a2}', 'Xss', '<img src=x onerror=alert(1)>', current_date + 300, current_date + 301)$q$,
    $q$insert into public.ical_feeds (tenant_id, room_id, name, url)
       values ('{tenant_a}', '{room_a1}', 'Internal', 'http://169.254.169.254/latest')$q$
  ],
  'error:23514');

-- ============================================================ R95-R99 team roles (20261122000000)
-- owner/admin manage everything; staff = front desk; cleaner = housekeeping;
-- maintenance = tickets. Payments only move through the logged functions.
select pg_temp.expect('R95 cleaners and maintenance see no guest data, payments, prices or invites',
  array['a_cleaner', 'a_maint'],
  array[
    $q$select guest_email as v from public.reservations where id = '{res_a}'$q$,
    $q$select name as v from public.guests where id = '{guest_a}'$q$,
    $q$select amount_cents as v from public.transactions where id = '{txn_a}'$q$,
    $q$select id as v from public.folio_entries where id = '{folio_a}'$q$,
    $q$select rate_plans::text as v from public.room_types where id = '{type_a}'$q$,
    $q$select url as v from public.ical_feeds where id = '{feed_a}'$q$,
    $q$select token as v from public.invites where id = '{invite_a}'$q$,
    $q$update public.reservations set paid_cents = total_cents where id = '{res_a}'$q$,
    $q$delete from public.reservations where id = '{res_a}'$q$,
    $q$insert into public.transactions (tenant_id, reservation_id, description, method, status, amount_cents)
       values ('{tenant_a}', '{res_a}', 'Cash', 'Cash', 'paid', 36000)$q$,
    $q$update public.room_types set rack_rate_cents = 1 where id = '{type_a}'$q$,
    $q$delete from public.tax_rules where id = '{tax_a}'$q$
  ],
  'denied');

select pg_temp.expect('R96 staff read pricing and feeds but only owners/admins change them; staff never see invite links',
  array['a_staff'],
  array[
    $q$update public.room_types set rack_rate_cents = 1 where id = '{type_a}'$q$,
    $q$update public.addons set price_cents = 1 where id = '{addon_a}'$q$,
    $q$delete from public.tax_rules where id = '{tax_a}'$q$,
    $q$update public.room_rate_overrides set rate_cents = 1 where id = '{override_a}'$q$,
    $q$insert into public.tax_rules (tenant_id, name, kind, rate) values ('{tenant_a}', 'Sneaky', 'percent', 0)$q$,
    $q$delete from public.ical_feeds where id = '{feed_a}'$q$,
    $q$delete from public.reservations where id = '{res_a}'$q$,
    $q$select token as v from public.invites where id = '{invite_a}'$q$
  ],
  'denied');
select pg_temp.expect('R96b staff read reservations, guests, payments and pricing (control)',
  array['a_staff'],
  array[
    $q$select guest_email as v from public.reservations where id = '{res_a}'$q$,
    $q$select amount_cents as v from public.transactions where id = '{txn_a}'$q$,
    $q$select rack_rate_cents as v from public.room_types where id = '{type_a}'$q$,
    $q$select url as v from public.ical_feeds where id = '{feed_a}'$q$
  ],
  'rows=1');
select pg_temp.expect('R96c owners and admins still change pricing (control)',
  array['a_owner', 'a_admin'],
  array[
    $q$update public.room_types set rack_rate_cents = 13000 where id = '{type_a}'$q$,
    $q$update public.tax_rules set rate = 11 where id = '{tax_a}'$q$,
    $q$select token as v from public.invites where id = '{invite_a}'$q$
  ],
  'rows=1');

select pg_temp.expect('R97 no browser role changes paid amounts or writes payments directly',
  array['a_owner', 'a_admin', 'a_staff'],
  array[
    $q$update public.reservations set paid_cents = total_cents where id = '{res_a}'$q$,
    $q$insert into public.transactions (tenant_id, reservation_id, description, method, status, amount_cents)
       values ('{tenant_a}', '{res_a}', 'Cash', 'Cash', 'paid', 36000)$q$,
    $q$update public.transactions set amount_cents = 1 where id = '{txn_a}'$q$,
    $q$delete from public.transactions where id = '{txn_a}'$q$
  ],
  'denied');
select pg_temp.expect('R97b paid amounts are refused with a clear reason',
  array['a_owner', 'a_staff'],
  array[$q$update public.reservations set paid_cents = total_cents where id = '{res_a}'$q$],
  'error:42501', 'payments_locked');
select pg_temp.expect('R97c the front desk still edits other booking fields (control)',
  array['a_owner', 'a_staff'],
  array[$q$update public.reservations set notes = 'Late arrival' where id = '{res_a}'$q$],
  'rows=1');

select pg_temp.expect('R98 staff and cleaners update housekeeping; everyone reads the room list (control)',
  array['a_staff', 'a_cleaner'],
  array[$q$update public.rooms set housekeeping_status = 'dirty', notes = 'Spill' where id = '{room_a1}'$q$],
  'rows=1');
select pg_temp.expect('R98b every team role reads the room list (control)',
  array['a_owner', 'a_staff', 'a_cleaner', 'a_maint'],
  array[$q$select code as v from public.rooms where tenant_id = '{tenant_a}'$q$],
  'rows=2');
select pg_temp.expect('R98c only owners/admins change room details; cleaners not room status',
  array['a_staff', 'a_cleaner'],
  array[
    $q$update public.rooms set rate_cents = 1 where id = '{room_a1}'$q$,
    $q$update public.rooms set name = 'Renamed' where id = '{room_a1}'$q$
  ],
  'error:42501', 'rooms_locked');
select pg_temp.expect('R98d cleaners cannot change occupancy status; maintenance cannot edit rooms',
  array['a_cleaner', 'a_maint'],
  array[
    $q$update public.rooms set status = 'occupied' where id = '{room_a1}'$q$,
    $q$insert into public.rooms (tenant_id, code, name) values ('{tenant_a}', 'ZZ', 'Sneaky room')$q$,
    $q$delete from public.rooms where id = '{room_a2}'$q$
  ],
  'denied');
select pg_temp.expect('R98e maintenance cannot change housekeeping status',
  array['a_maint'],
  array[$q$update public.rooms set housekeeping_status = 'clean' where id = '{room_a1}'$q$],
  'denied');

select pg_temp.expect('R99 maintenance works tickets end to end (control)',
  array['a_maint'],
  array[
    $q$select title as v from public.maintenance_tickets where id = '{ticket_a}'$q$,
    $q$update public.maintenance_tickets set status = 'in_progress' where id = '{ticket_a}'$q$,
    $q$insert into public.maintenance_tickets (tenant_id, room_id, title) values ('{tenant_a}', '{room_a1}', 'Broken lamp')$q$,
    $q$delete from public.maintenance_tickets where id = '{ticket_a}'$q$
  ],
  'rows=1');
select pg_temp.expect('R99b cleaners report and update tickets but cannot delete them',
  array['a_cleaner'],
  array[$q$delete from public.maintenance_tickets where id = '{ticket_a}'$q$],
  'denied');
select pg_temp.expect('R99c turnover list: housekeeping sees stays without guest details',
  array['a_owner', 'a_staff', 'a_cleaner'],
  array[$q$select (to_jsonb(t) - array['room_id', 'check_in', 'check_out', 'status', 'adults', 'children', 'infants'])::text as v
          from public.housekeeping_turnovers('{tenant_a}', current_date + 100, 2) t$q$],
  'value~^\{\}$');
select pg_temp.expect('R99d turnover list is empty for maintenance and other properties',
  array['a_maint', 'b_owner'],
  array[$q$select room_id as v from public.housekeeping_turnovers('{tenant_a}', current_date + 100, 14)$q$],
  'rows=0');
select pg_temp.expect('R99e the role list accepts maintenance and nothing unknown',
  array['service'],
  array[$q$insert into public.tenant_members (tenant_id, user_id, role) values ('{tenant_b}', '{a_maint}', 'janitor')$q$],
  'error:23514');

-- ============================================================ R100-R103 cleanup (20261123000000)
select pg_temp.expect('R100 no browser role reads the calendar token or billing ids directly',
  array['a_owner', 'a_admin', 'a_staff', 'a_cleaner', 'a_maint', 'b_owner'],
  array[
    $q$select ical_token as v from public.tenants where id = '{tenant_a}'$q$,
    $q$select stripe_customer_id as v from public.tenants where id = '{tenant_a}'$q$,
    $q$select * from public.tenants where id = '{tenant_a}'$q$
  ],
  'error:42501');
select pg_temp.expect('R100b member_tenant gives owners/admins the calendar token',
  array['a_owner', 'a_admin'],
  array[$q$select public.member_tenant('{tenant_a}') ->> 'ical_token' as v$q$],
  'value~^[0-9a-f]{64}$');
select pg_temp.expect('R100c member_tenant hides secrets from other roles and other properties',
  array['a_staff', 'a_cleaner', 'a_maint', 'b_owner', 'outsider'],
  array[
    $q$select public.member_tenant('{tenant_a}') ->> 'ical_token' as v$q$,
    $q$select public.member_tenant('{tenant_a}') ->> 'stripe_customer_id' as v$q$
  ],
  'value!~.');
select pg_temp.expect('R100d members still read the rest of their property (control)',
  array['a_staff', 'a_cleaner'],
  array[
    $q$select public.member_tenant('{tenant_a}') ->> 'name' as v$q$,
    $q$select name as v from public.tenants where id = '{tenant_a}'$q$
  ],
  'value~^RLS Check A$');

select pg_temp.expect('R101 after 20 wrong promo codes a connection sees no coded plans, even with the right code',
  array['anon'],
  array[$q$select e.p ->> 'name' as v from public.get_rate_plans('{tenant_a}', 'rlscode') g,
          jsonb_array_elements(g.rate_plans) e(p) where e.p ->> 'promoCode' = 'RLSCODE'$q$],
  'rows=0', null,
  $s$insert into public.promo_attempts (ip_hash) select encode(sha256(convert_to('198.51.100.77', 'UTF8')), 'hex') from generate_series(1, 20);
     select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.77"}', true)$s$);
select pg_temp.expect('R101b below the limit the right code still works (control)',
  array['anon'],
  array[$q$select e.p ->> 'name' as v from public.get_rate_plans('{tenant_a}', 'rlscode') g,
          jsonb_array_elements(g.rate_plans) e(p) where e.p ->> 'promoCode' = 'RLSCODE'$q$],
  'rows=1', null,
  $s$select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.78"}', true)$s$);

select pg_temp.rec('R102 browsers hold no unused table privileges (anon writes, TRUNCATE/REFERENCES/TRIGGER)',
  (select count(*) from information_schema.role_table_grants g
   where g.table_schema = 'public' and (
     (g.grantee = 'anon' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
     or (g.grantee = 'authenticated' and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')))) = 0,
  coalesce((select string_agg(g.grantee || ':' || g.privilege_type || ':' || g.table_name, ', ')
            from information_schema.role_table_grants g
            where g.table_schema = 'public' and (
              (g.grantee = 'anon' and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
              or (g.grantee = 'authenticated' and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')))), 'none'));

select pg_temp.expect('R103 cleaners and maintenance have no support access',
  array['a_cleaner', 'a_maint'],
  array[
    $q$select subject as v from public.support_cases where id = '{case_a}'$q$,
    $q$select body as v from public.support_messages where case_id = '{case_a}'$q$,
    $q$insert into public.support_messages (case_id, tenant_id, sender, body) values ('{case_a}', '{tenant_a}', 'user', 'peek')$q$,
    $q$update public.support_cases set status = 'closed' where id = '{case_a}'$q$
  ],
  'denied');
select pg_temp.expect('R103b the front desk sees every case for the property (control)',
  array['a_owner', 'a_admin', 'a_staff'],
  array[
    $q$select subject as v from public.support_cases where id = '{case_a}'$q$,
    $q$select body as v from public.support_messages where case_id = '{case_a}'$q$
  ],
  'rows=1');
select pg_temp.expect('R103c housekeeping and maintenance cannot open or follow support cases',
  array['a_cleaner', 'a_maint'],
  array[
    $q$insert into public.support_cases (tenant_id, user_id, subject) values ('{tenant_a}', '{a_cleaner}', 'Broken vacuum')$q$,
    $q$update public.support_cases set status = 'pending' where tenant_id = '{tenant_a}' and user_id = '{a_cleaner}'$q$
  ],
  'denied',
  null,
  $s$insert into public.support_cases (tenant_id, user_id, subject) values (pg_temp.id('tenant_a'), pg_temp.id('a_cleaner'), 'Earlier issue')$s$);
select pg_temp.expect('R103d members cannot open cases in someone else''s name',
  array['a_cleaner', 'a_staff'],
  array[$q$insert into public.support_cases (tenant_id, user_id, subject) values ('{tenant_a}', '{a_owner}', 'Spoofed')$q$],
  'denied');

-- ============================================================ R104 server error log (20261126000000)
select pg_temp.expect('R104 browsers cannot write server errors',
  array['anon', 'a_owner'],
  array[$q$select public.log_server_error('charge-guest', 'forged', null, null)$q$],
  'denied');
do $$
declare n int;
begin
  perform pg_temp.act_as('service');
  perform public.log_server_error('rls-check-fn', 'RLS check boom', 'stack', null);
  perform public.log_server_error('rls-check-fn', 'RLS check boom', 'stack', null);
  reset role;
  select count into n from public.client_errors where source = 'rls-check-fn' and page = 'server' and day = current_date;
  perform pg_temp.verdict(n = 2, 'count=' || coalesce(n::text, 'none'));
exception when others then
  perform pg_temp.caught('R104b the functions log server errors, one row per error per day', sqlstate, sqlerrm);
end $$;

-- ============================================================ R105 team management (20261127000000)
select pg_temp.expect('R105 owners and admins see the team with login emails',
  array['a_owner', 'a_admin'],
  array[$q$select email as v from public.team_members('{tenant_a}')$q$],
  'rows=5');
select pg_temp.expect('R105b nobody else gets the team list',
  array['a_staff', 'a_cleaner', 'a_maint', 'b_owner', 'outsider', 'anon'],
  array[$q$select email as v from public.team_members('{tenant_a}')$q$],
  'denied');
select pg_temp.expect('R105c the last owner cannot remove or demote themselves',
  array['a_owner'],
  array[
    $q$delete from public.tenant_members where tenant_id = '{tenant_a}' and user_id = '{a_owner}'$q$,
    $q$update public.tenant_members set role = 'admin' where tenant_id = '{tenant_a}' and user_id = '{a_owner}'$q$
  ],
  'error:23514', 'last_owner');
select pg_temp.expect('R105d with a second owner, an owner can step down (control)',
  array['a_owner'],
  array[$q$update public.tenant_members set role = 'admin' where tenant_id = '{tenant_a}' and user_id = '{a_owner}'$q$],
  'rows=1', null,
  $s$update public.tenant_members set role = 'owner' where tenant_id = pg_temp.id('tenant_a') and user_id = pg_temp.id('a_admin')$s$);
select pg_temp.expect('R105f the owner can still delete the whole property (members go with it)',
  array['a_owner'],
  array[$q$delete from public.tenants where id = '{tenant_a}'$q$],
  'rows=1');
select pg_temp.expect('R105e owners change roles and remove members (control)',
  array['a_owner'],
  array[
    $q$update public.tenant_members set role = 'cleaner' where tenant_id = '{tenant_a}' and user_id = '{a_staff}'$q$,
    $q$delete from public.tenant_members where tenant_id = '{tenant_a}' and user_id = '{a_maint}'$q$
  ],
  'rows=1');

-- ============================================================ R106 invite sign-up (20261128000000)
select pg_temp.expect('R106 browsers cannot look up accounts by email',
  array['anon', 'a_owner', 'outsider'],
  array[$q$select id as v from public.auth_user_by_email('a-owner@rls-check.invalid')$q$],
  'denied');
select pg_temp.expect('R106b the invite function can (control)',
  array['service'],
  array[$q$select confirmed::text as v from public.auth_user_by_email('A-Owner@rls-check.invalid')$q$],
  'value~^true$');

-- ============================================================ R00 run integrity (recorded last, sorted first)
select pg_temp.rec('R00 one transaction, fixtures in place (the final raise rolls all of it back)',
  (select txid from pg_temp.rls_meta) = txid_current()
    and (select count(*) from public.tenants where slug in ('rls-check-a', 'rls-check-b', 'rls-check-c')) = 3,
  format('txid %s -> %s', (select txid from pg_temp.rls_meta), txid_current()));

-- The runner appends the final DO block that raises the results (and so rolls
-- everything back); never add it here.
