-- SimpleHotelier — owners manage their own subscription (Stripe Customer
-- Portal: change card, download invoices, cancel). The webhook records when
-- a cancelled subscription stops, so Settings can say "Ends Nov 26".
--   node scripts/apply-sql.mjs supabase/migrations/20261129000000_billing_portal.sql

-- @@CHUNK@@
alter table public.tenants add column if not exists subscription_cancel_at timestamptz;

-- Like the other billing columns, only the Stripe webhook sets it. A separate
-- trigger, so tenants_guard() stays as it is.
create or replace function public.tenants_billing_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.subscription_cancel_at := null;
  elsif new.subscription_cancel_at is distinct from old.subscription_cancel_at then
    raise exception 'billing and account fields are managed by SimpleHotelier'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_tenants_billing_guard on public.tenants;
create trigger trg_tenants_billing_guard before insert or update on public.tenants
  for each row execute function public.tenants_billing_guard();
