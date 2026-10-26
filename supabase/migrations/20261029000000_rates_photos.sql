-- SimpleHotelier — room photos + per-date rate overrides.
-- Apply after 20261028000000_admin_support.sql.

alter table public.rooms add column if not exists photos jsonb not null default '[]'::jsonb;

-- @@CHUNK@@
create table if not exists public.room_rate_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  date date not null,
  rate_cents int not null check (rate_cents >= 0),
  created_at timestamptz not null default now(),
  unique (room_id, date)
);

create index if not exists idx_rate_overrides_room_date on public.room_rate_overrides (room_id, date);

alter table public.room_rate_overrides enable row level security;

create policy rate_overrides_member_all on public.room_rate_overrides
  for all to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Rates are public pricing data (guests need nightly totals); no guest data here.
create policy rate_overrides_public_read on public.room_rate_overrides
  for select to anon using (true);
