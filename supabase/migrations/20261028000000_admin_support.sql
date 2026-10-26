-- SimpleHotelier — Stripe billing fields, system admins, support cases.
-- Apply after 20261027000000_booking.sql.

-- ============================================================ billing (Stripe)
alter table public.tenants add column if not exists stripe_customer_id text;
alter table public.tenants add column if not exists stripe_subscription_id text;
alter table public.tenants add column if not exists subscription_status text not null default 'trialing'
  check (subscription_status in ('trialing','active','past_due','canceled','incomplete','unpaid'));
alter table public.tenants add column if not exists current_period_end timestamptz;
alter table public.tenants add column if not exists plan_price_cents int not null default 3000;

-- @@CHUNK@@
-- ============================================================ system admins
create table if not exists public.system_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.system_admins where user_id = auth.uid())
$$;

alter table public.system_admins enable row level security;
create policy system_admins_self_read on public.system_admins
  for select to authenticated using (user_id = auth.uid() or public.is_system_admin());

-- Admins can read every tenant (subscriber management). Writes stay owner-scoped.
create policy tenants_admin_read on public.tenants
  for select to authenticated using (public.is_system_admin());

-- @@CHUNK@@
-- ============================================================ support
create table if not exists public.support_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  requester_email text,
  subject text not null,
  category text not null default 'help' check (category in ('help','billing','bug','feature','account')),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases (id) on delete cascade,
  tenant_id uuid references public.tenants (id) on delete set null,
  sender text not null check (sender in ('user','ai','admin','system')),
  author_email text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_cases_tenant on public.support_cases (tenant_id, created_at desc);
create index if not exists idx_cases_status on public.support_cases (status, created_at desc);
create index if not exists idx_msgs_case on public.support_messages (case_id, created_at);

drop trigger if exists trg_support_cases_updated on public.support_cases;
create trigger trg_support_cases_updated before update on public.support_cases
  for each row execute function public.set_updated_at();

alter table public.support_cases enable row level security;
alter table public.support_messages enable row level security;

-- Members: own tenant's cases. Admins: everything.
create policy cases_member_all on public.support_cases
  for all to authenticated
  using (public.is_tenant_member(tenant_id) or public.is_system_admin())
  with check (public.is_tenant_member(tenant_id) or public.is_system_admin());
create policy msgs_member_all on public.support_messages
  for all to authenticated
  using (
    public.is_system_admin()
    or exists (
      select 1 from public.support_cases c
      where c.id = case_id and public.is_tenant_member(c.tenant_id)
    )
  )
  with check (
    public.is_system_admin()
    or exists (
      select 1 from public.support_cases c
      where c.id = case_id and public.is_tenant_member(c.tenant_id)
    )
  );
