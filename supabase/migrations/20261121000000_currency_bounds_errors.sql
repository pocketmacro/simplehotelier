-- SimpleHotelier — production hardening, part 3.
-- 1. Currency: each property picks a supported currency (two-decimal only,
--    because every amount is stored in cents). It locks once the property
--    has payments, so past money is never relabelled.
-- 2. Bounded dashboard loads: reservations.balance_cents lets the dashboard
--    load recent stays plus anything still owing, instead of every booking
--    ever (PostgREST also caps each response at 1000 rows).
-- 3. Error monitoring: browsers report uncaught errors through
--    log_client_error() into client_errors (deduplicated per day, throttled
--    per connection, pruned after 30 days). System admins read them.
-- Safe to apply before the site deploy: nothing here changes what the
-- current pages send or read.
--   node scripts/apply-sql.mjs supabase/migrations/20261121000000_currency_bounds_errors.sql

-- @@CHUNK@@
-- ---------------------------------------------------------------- currency
alter table public.tenants drop constraint if exists tenants_currency_supported;
alter table public.tenants add constraint tenants_currency_supported check (currency in (
  'USD', 'CAD', 'MXN', 'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'AUD', 'NZD', 'ZAR', 'SGD', 'HKD'));

create or replace function public.tenants_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_slug_changed boolean := true;
  v_token_changed boolean := false;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_slug_changed := new.slug is distinct from old.slug;
    v_token_changed := new.ical_token is distinct from old.ical_token;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.stripe_account_id := null;
    new.stripe_onboarding_complete := false;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.subscription_status := 'trialing';
    new.current_period_end := null;
    new.plan_price_cents := 3000;
    new.last_weekly_report_at := null;
    new.ical_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  elsif new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_onboarding_complete is distinct from old.stripe_onboarding_complete
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.current_period_end is distinct from old.current_period_end
     or new.plan_price_cents is distinct from old.plan_price_cents
     or new.last_weekly_report_at is distinct from old.last_weekly_report_at then
    raise exception 'billing and account fields are managed by SimpleHotelier'
      using errcode = '42501';
  end if;
  -- Amounts are stored without a currency, so changing it after money has
  -- moved would relabel every past payment and balance.
  if tg_op = 'UPDATE' and new.currency is distinct from old.currency
     and exists (select 1 from public.transactions t where t.tenant_id = new.id) then
    raise exception 'currency_locked' using errcode = '22023',
      detail = 'The currency can''t be changed after the property has recorded payments.';
  end if;
  -- Slugs become subdomains ({slug}.simplehotelier.com): lowercase DNS
  -- labels only, and never one of our own service names.
  if v_slug_changed then
    if new.slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
       or new.slug = any (array['www', 'app', 'api', 'admin', 'mail', 'email', 'book', 'booking',
                                'support', 'help', 'status', 'blog', 'docs', 'dashboard',
                                'static', 'assets', 'cdn', 'auth', 'billing', 'stripe']) then
      raise exception 'invalid booking page address' using errcode = '22023',
        detail = 'Use lowercase letters, numbers and hyphens.';
    end if;
  end if;
  if v_token_changed and char_length(coalesce(new.ical_token, '')) < 32 then
    raise exception 'calendar token too short' using errcode = '22023';
  end if;
  return new;
end $$;

-- @@CHUNK@@
-- ---------------------------------------------------------------- bounded loads
alter table public.reservations
  add column if not exists balance_cents int generated always as (total_cents - paid_cents) stored;
create index if not exists idx_res_tenant_checkout on public.reservations (tenant_id, check_out);
create index if not exists idx_res_tenant_owing on public.reservations (tenant_id)
  where balance_cents > 0 and status <> 'cancelled';

-- @@CHUNK@@
-- ---------------------------------------------------------------- error monitoring
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  day date not null default current_date,
  fingerprint text not null,
  page text not null,
  message text not null,
  source text,
  stack text,
  url text,
  user_agent text,
  tenant_id uuid,
  count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (day, fingerprint)
);
create index if not exists idx_client_errors_seen on public.client_errors (last_seen desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant select on public.client_errors to authenticated;
drop policy if exists client_errors_admin_read on public.client_errors;
create policy client_errors_admin_read on public.client_errors
  for select to authenticated using (public.is_system_admin());

create table if not exists public.client_error_hits (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_client_error_hits_ip on public.client_error_hits (ip_hash, created_at);
alter table public.client_error_hits enable row level security;
revoke all on public.client_error_hits from anon, authenticated;

-- Called by js/error-report.js. Never raises: a page that is already failing
-- must not get a second error back. Drops reports past 60 per connection per
-- hour or 2000 distinct errors per day.
create or replace function public.log_client_error(
  p_page text,
  p_message text,
  p_source text default null,
  p_stack text default null,
  p_url text default null,
  p_tenant uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_headers json;
  v_ip text := '';
  v_hash text;
  v_msg text := left(btrim(coalesce(p_message, '')), 500);
  v_page text := case when p_page in ('book', 'app', 'landing') then p_page else 'other' end;
  v_source text := left(btrim(coalesce(p_source, '')), 300);
begin
  if v_msg = '' then
    return;
  end if;
  begin
    v_headers := current_setting('request.headers', true)::json;
    v_ip := btrim(coalesce(v_headers ->> 'cf-connecting-ip',
                           split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''));
  exception when others then
    v_headers := null;
    v_ip := '';
  end;
  v_hash := encode(sha256(convert_to(coalesce(nullif(v_ip, ''), 'unknown'), 'UTF8')), 'hex');
  if (select count(*) from public.client_error_hits h
      where h.ip_hash = v_hash and h.created_at > now() - interval '1 hour') >= 60 then
    return;
  end if;
  insert into public.client_error_hits (ip_hash) values (v_hash);

  insert into public.client_errors as e (fingerprint, page, message, source, stack, url, user_agent, tenant_id)
  select md5(v_page || '|' || v_msg || '|' || v_source), v_page, v_msg, nullif(v_source, ''),
         nullif(left(coalesce(p_stack, ''), 4000), ''), nullif(left(coalesce(p_url, ''), 300), ''),
         left(v_headers ->> 'user-agent', 300), (select t.id from public.tenants t where t.id = p_tenant)
  where (select count(*) from public.client_errors c where c.day = current_date) < 2000
  on conflict (day, fingerprint) do update set count = e.count + 1, last_seen = now();
exception when others then
  return;
end $$;

revoke execute on function public.log_client_error(text, text, text, text, text, uuid) from public;
grant execute on function public.log_client_error(text, text, text, text, text, uuid) to anon, authenticated, service_role;

create or replace function public.prune_client_errors()
returns void language sql security definer set search_path = public as $$
  delete from public.client_errors where day < current_date - 30;
  delete from public.client_error_hits where created_at < now() - interval '1 day';
$$;
revoke execute on function public.prune_client_errors() from public, anon, authenticated;

-- @@CHUNK@@
do $$ begin
  perform cron.unschedule('simplehotelier-prune-errors');
exception when others then null;
end $$;
select cron.schedule('simplehotelier-prune-errors', '40 3 * * *', $$select public.prune_client_errors()$$);

notify pgrst, 'reload schema';
