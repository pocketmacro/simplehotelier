-- SimpleHotelier — security cleanup (the last open review findings).
-- 1. Property secrets: browsers can no longer read tenants.ical_token (the
--    calendar-export link) or the platform's Stripe billing ids directly.
--    The dashboard loads its property through member_tenant(), which adds
--    them for owners and admins only.
-- 2. Promo codes: get_rate_plans() counts wrong codes per connection; after
--    20 in an hour it stops revealing coded plans (no guessing them).
-- 3. Default grants: browsers lose table privileges nothing uses (anon
--    writes; TRUNCATE/REFERENCES/TRIGGER for everyone), now and for new
--    tables. RLS already blocked these; this is a second lock.
-- 4. Support: cleaners and maintenance see only the cases they opened; the
--    front desk and admins see every case for the property.
-- Deploy the site first (its dashboard falls back to the old property read
-- until member_tenant() exists), then apply this.
--   node scripts/apply-sql.mjs supabase/migrations/20261123000000_security_cleanup.sql

-- @@CHUNK@@
-- ---------------------------------------------------------------- property secrets
revoke select on public.tenants from authenticated;
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tenants'
    and column_name not in ('ical_token', 'stripe_customer_id', 'stripe_subscription_id');
  execute format('grant select (%s) on public.tenants to authenticated', v_cols);
end $$;

-- The signed-in member's property as one JSON object (every column, so new
-- columns need no grant), with the secrets for owners/admins only.
create or replace function public.member_tenant(p_tenant uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t)
         - case when public.has_tenant_role(t.id, array['owner', 'admin']) then array[]::text[]
                else array['ical_token', 'stripe_customer_id', 'stripe_subscription_id'] end
  from public.tenants t
  where t.id = p_tenant and public.is_tenant_member(t.id)
$$;
revoke execute on function public.member_tenant(uuid) from public, anon;
grant execute on function public.member_tenant(uuid) to authenticated, service_role;

-- @@CHUNK@@
-- ---------------------------------------------------------------- promo codes
create table if not exists public.promo_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  tenant_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_promo_attempts_ip on public.promo_attempts (ip_hash, created_at);
alter table public.promo_attempts enable row level security;
revoke all on public.promo_attempts from anon, authenticated;

-- Same result as before (public plans, plus the coded plan whose code was
-- typed, never other codes), now volatile so it can count wrong guesses.
create or replace function public.get_rate_plans(p_tenant uuid, p_promo text default null)
returns table (room_type_id uuid, rate_plans jsonb)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_code text := upper(btrim(coalesce(p_promo, '')));
  v_headers json;
  v_ip text := '';
  v_hash text;
begin
  if v_code <> '' then
    begin
      v_headers := current_setting('request.headers', true)::json;
      v_ip := btrim(coalesce(v_headers ->> 'cf-connecting-ip',
                             split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''));
    exception when others then
      v_ip := '';
    end;
    v_hash := encode(sha256(convert_to(coalesce(nullif(v_ip, ''), 'unknown'), 'UTF8')), 'hex');
    delete from public.promo_attempts a where a.created_at < now() - interval '1 day';
    if (select count(*) from public.promo_attempts a
        where a.ip_hash = v_hash and a.created_at > now() - interval '1 hour') >= 20 then
      v_code := ''; -- too many wrong codes from this connection: public plans only
    elsif not exists (
      select 1 from public.room_types rt,
        jsonb_array_elements(case when jsonb_typeof(rt.rate_plans) = 'array' then rt.rate_plans else '[]'::jsonb end) as e(p)
      where rt.tenant_id = p_tenant and upper(e.p ->> 'promoCode') = v_code) then
      insert into public.promo_attempts (ip_hash, tenant_id) values (v_hash, p_tenant);
    end if;
  end if;

  return query
  select rt.id,
    coalesce((
      select jsonb_agg(case when coalesce(e.p ->> 'promoCode', '') = '' then e.p
                            else e.p || jsonb_build_object('promoCode', v_code) end
                       order by e.ord)
      from jsonb_array_elements(case when jsonb_typeof(rt.rate_plans) = 'array' then rt.rate_plans else '[]'::jsonb end)
           with ordinality as e(p, ord)
      where coalesce(e.p ->> 'promoCode', '') = ''
         or (v_code <> '' and upper(e.p ->> 'promoCode') = v_code)
    ), '[]'::jsonb)
  from public.room_types rt
  where rt.tenant_id = p_tenant;
end $$;
revoke execute on function public.get_rate_plans(uuid, text) from public;
grant execute on function public.get_rate_plans(uuid, text) to anon, authenticated, service_role;

-- @@CHUNK@@
-- ---------------------------------------------------------------- default grants
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', r.relname);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', r.relname);
  end loop;
end $$;
-- New tables: same defaults (anon reads only where a policy allows it).
do $$
begin
  alter default privileges for role postgres in schema public
    revoke insert, update, delete, truncate, references, trigger on tables from anon;
  alter default privileges for role postgres in schema public
    revoke truncate, references, trigger on tables from authenticated;
exception when insufficient_privilege then
  raise notice 'default privileges unchanged (run as postgres to update them)';
end $$;

-- @@CHUNK@@
-- ---------------------------------------------------------------- support cases
create or replace function public.can_see_support_case(p_case uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.support_cases c
    where c.id = p_case and (
      public.is_system_admin()
      or public.has_tenant_role(c.tenant_id, array['owner', 'admin', 'staff'])
      or (c.user_id = auth.uid() and public.is_tenant_member(c.tenant_id))))
$$;
revoke execute on function public.can_see_support_case(uuid) from public, anon;
grant execute on function public.can_see_support_case(uuid) to authenticated, service_role;

drop policy if exists cases_member_all on public.support_cases;
drop policy if exists cases_read on public.support_cases;
drop policy if exists cases_insert on public.support_cases;
drop policy if exists cases_update on public.support_cases;
drop policy if exists cases_delete on public.support_cases;
create policy cases_read on public.support_cases for select to authenticated
  using (public.is_system_admin()
         or public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff'])
         or (user_id = auth.uid() and public.is_tenant_member(tenant_id)));
create policy cases_insert on public.support_cases for insert to authenticated
  with check (public.is_system_admin()
              or (public.is_tenant_member(tenant_id) and user_id = auth.uid()));
create policy cases_update on public.support_cases for update to authenticated
  using (public.is_system_admin()
         or public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff'])
         or (user_id = auth.uid() and public.is_tenant_member(tenant_id)))
  with check (public.is_system_admin() or public.is_tenant_member(tenant_id));
create policy cases_delete on public.support_cases for delete to authenticated
  using (public.is_system_admin() or public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists msgs_read on public.support_messages;
drop policy if exists msgs_insert on public.support_messages;
create policy msgs_read on public.support_messages for select to authenticated
  using (public.is_system_admin() or public.can_see_support_case(case_id));
create policy msgs_insert on public.support_messages for insert to authenticated
  with check (public.is_system_admin() or (sender = 'user' and public.can_see_support_case(case_id)));

notify pgrst, 'reload schema';
