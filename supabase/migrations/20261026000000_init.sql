-- SimpleHotelier — initial schema (Supabase / PostgreSQL)
-- Apply: Supabase Dashboard -> SQL Editor -> paste this file, or `supabase db push`.
-- Money is stored as integer cents everywhere. Dates are property-local dates.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ============================================================ helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- @@CHUNK@@
-- ============================================================ tenants
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  name text not null,
  slug text not null unique,               -- booking page: {slug}.simplehotelier.com
  contact_email text,
  phone text,
  address text,
  logo_url text,
  brand_color text not null default '#0c3b3c',
  booking_headline text,
  booking_subheading text,
  check_in_time text not null default '3:00 PM',
  check_out_time text not null default '11:00 AM',
  cancellation_policy text not null default 'moderate',
  currency text not null default 'USD',
  stripe_account_id text,                  -- Stripe Connect account (acct_...)
  stripe_onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','staff','cleaner')),
  invited_email text,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- Tenant helpers (after tenant_members exists: SQL functions validate refs at creation).
create or replace function public.member_tenant_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.tenant_members where user_id = auth.uid()
$$;

create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant and user_id = auth.uid()
  )
$$;

-- @@CHUNK@@
-- ============================================================ inventory
create table if not exists public.room_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  room_type_id uuid references public.room_types (id) on delete set null,
  code text not null,                      -- A1, B2 ...
  name text not null,
  sleeps int not null default 2,
  rate_cents int not null default 0 check (rate_cents >= 0),
  weekend_rate_cents int,
  status text not null default 'vacant' check (status in ('vacant','occupied','reserved')),
  housekeeping_status text not null default 'clean'
    check (housekeeping_status in ('clean','dirty','progress')),
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table if not exists public.addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  price_cents int not null default 0 check (price_cents >= 0),
  per text not null default 'stay' check (per in ('stay','night','person')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('percent','night')),
  rate numeric(10,4) not null default 0,   -- percent points (6.5 = 6.5%) or flat amount in dollars
  applies_to text not null default 'Room + add-ons',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- @@CHUNK@@
-- ============================================================ guests + reservations
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete restrict,
  guest_id uuid references public.guests (id) on delete set null,
  guest_name text not null,
  guest_email text,
  guest_phone text,
  confirmation_code text not null,
  check_in date not null,
  check_out date not null,
  stay_range daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  status text not null default 'confirmed'
    check (status in ('pending','confirmed','checked_in','checked_out','cancelled')),
  source text not null default 'direct' check (source in ('direct','phone','walkin','airbnb','vrbo','other')),
  adults int not null default 2,
  notes text,
  subtotal_cents int not null default 0,
  tax_cents int not null default 0,
  total_cents int not null default 0,
  paid_cents int not null default 0,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in),
  unique (tenant_id, confirmation_code),
  -- No double-booking: same room, overlapping stay, still-active reservation.
  exclude using gist (room_id with =, stay_range with &&)
    where (status in ('pending','confirmed','checked_in'))
);

create table if not exists public.reservation_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  addon_id uuid references public.addons (id) on delete set null,
  name_snapshot text not null,
  price_cents int not null default 0,
  qty int not null default 1,
  created_at timestamptz not null default now()
);

-- @@CHUNK@@
-- Folio lines + money movement (charges, payments, refunds in one ledger).
create table if not exists public.folio_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  kind text not null check (kind in ('room','addon','tax','fee','payment','refund','adjustment')),
  description text not null,
  amount_cents int not null,               -- charges positive, payments/refunds negative by convention in UI
  stripe_object_id text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete set null,
  description text not null,
  method text,
  status text not null default 'paid' check (status in ('paid','pending','failed','refunded')),
  amount_cents int not null,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rooms_tenant on public.rooms (tenant_id);
create index if not exists idx_res_room on public.reservations (room_id);
create index if not exists idx_res_tenant_dates on public.reservations (tenant_id, check_in, check_out);
create index if not exists idx_folio_res on public.folio_entries (reservation_id);
create index if not exists idx_members_user on public.tenant_members (user_id);

-- updated_at triggers
do $$ declare t text; begin
  foreach t in array array['tenants','room_types','rooms','addons','tax_rules','guests','reservations'] loop
    execute format('drop trigger if exists trg_%s_updated on public.%I', t, t);
    execute format('create trigger trg_%s_updated before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- @@CHUNK@@
-- ============================================================ RLS
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.room_types enable row level security;
alter table public.rooms enable row level security;
alter table public.addons enable row level security;
alter table public.tax_rules enable row level security;
alter table public.guests enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_addons enable row level security;
alter table public.folio_entries enable row level security;
alter table public.transactions enable row level security;

-- Tenants: members manage; anyone may read the public booking profile by slug.
create policy tenants_member_all on public.tenants
  for all to authenticated
  using (public.is_tenant_member(id))
  with check (public.is_tenant_member(id));
create policy tenants_create on public.tenants
  for insert to authenticated with check (created_by = auth.uid());
create policy tenants_public_read on public.tenants
  for select to anon using (true);

create policy members_self_read on public.tenant_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_tenant_member(tenant_id));
create policy members_self_insert on public.tenant_members
  for insert to authenticated with check (user_id = auth.uid());
create policy members_owner_manage on public.tenant_members
  for all to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- @@CHUNK@@
-- Generic tenant-scoped tables.
do $$ declare t text; begin
  foreach t in array array['room_types','rooms','addons','tax_rules','guests','reservations','reservation_addons','folio_entries','transactions'] loop
    execute format('create policy %I on public.%I for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id))', t || '_member_all', t);
  end loop;
end $$;

-- Public booking page (anon): read what's needed to book, create requests only.
create policy rooms_public_read on public.rooms for select to anon using (true);
create policy addons_public_read on public.addons for select to anon using (active = true);
create policy tax_rules_public_read on public.tax_rules for select to anon using (active = true);
create policy reservations_public_request on public.reservations
  for insert to anon with check (status = 'pending');

-- @@CHUNK@@
-- ============================================================ storage
insert into storage.buckets (id, name, public) values
  ('room-photos', 'room-photos', true),
  ('property-logos', 'property-logos', true)
on conflict (id) do nothing;

create policy storage_public_read on storage.objects
  for select to anon, authenticated using (bucket_id in ('room-photos','property-logos'));
create policy storage_auth_write on storage.objects
  for insert to authenticated with check (bucket_id in ('room-photos','property-logos'));
create policy storage_auth_update on storage.objects
  for update to authenticated using (bucket_id in ('room-photos','property-logos'));
