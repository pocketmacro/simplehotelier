-- SimpleHotelier — pricing moves from individual rooms to room types
-- (the hotel model: King / Queen / Suite / Accessible each carry one rate;
-- units of a type inherit it). Per-date overrides follow the type.
-- Rooms keep rate_cents as a legacy fallback for untyped rooms only.

alter table public.room_rate_overrides
  add column if not exists room_type_id uuid references public.room_types (id) on delete cascade;

-- Backfill from each room's type (rows on untyped rooms are dropped below).
update public.room_rate_overrides o
  set room_type_id = r.room_type_id
  from public.rooms r
  where r.id = o.room_id and o.room_type_id is null;

delete from public.room_rate_overrides where room_type_id is null;

-- Same type + date may exist once per room today; keep the most recent.
delete from public.room_rate_overrides o
  using public.room_rate_overrides x
  where o.room_type_id = x.room_type_id and o.date = x.date
    and o.created_at < x.created_at;

-- @@CHUNK@@
alter table public.room_rate_overrides drop constraint if exists room_rate_overrides_room_id_date_key;
drop index if exists idx_rate_overrides_room_date;
alter table public.room_rate_overrides drop column if exists room_id;
alter table public.room_rate_overrides alter column room_type_id set not null;
alter table public.room_rate_overrides
  add constraint room_rate_overrides_type_date_key unique (room_type_id, date);
create index if not exists idx_rate_overrides_type_date
  on public.room_rate_overrides (room_type_id, date);
