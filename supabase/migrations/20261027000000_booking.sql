-- SimpleHotelier — booking page settings + safe public availability.
-- Apply after 20261026000000_init.sql (SQL Editor or scripts/apply-booking-migration.ps1).

-- Per-property analytics + conversion tracking settings.
alter table public.tenants add column if not exists ga_measurement_id text;
alter table public.tenants add column if not exists booking_redirect_url text;

-- @@CHUNK@@
-- Rooms available for a date range, without exposing any reservation/guest data.
-- A room is unavailable when an active reservation overlaps [check_in, check_out).
create or replace function public.get_available_room_ids(p_tenant uuid, p_check_in date, p_check_out date)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
  from public.rooms r
  where r.tenant_id = p_tenant
    and p_check_out > p_check_in
    and not exists (
      select 1
      from public.reservations res
      where res.room_id = r.id
        and res.status in ('pending', 'confirmed', 'checked_in')
        and res.stay_range && daterange(p_check_in, p_check_out, '[)')
    )
$$;

grant execute on function public.get_available_room_ids(uuid, date, date) to anon, authenticated;

-- Guests may attach chosen add-ons to their own booking request.
-- (The reservation UUID is client-generated, so no reservation reads are exposed.)
create policy reservation_addons_public_insert on public.reservation_addons
  for insert to anon with check (true);
