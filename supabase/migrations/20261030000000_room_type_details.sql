-- SimpleHotelier — rich room type details (occupancy, rates, beds, features, photos)
-- New columns are additive with defaults, so existing room_types rows keep working.
-- Money stays in integer cents; lists (beds / features / photos) are JSONB arrays.

alter table public.room_types
  add column if not exists bathrooms numeric(3,1) not null default 1,
  add column if not exists view text,
  add column if not exists smoking_policy text not null default 'non-smoking',
  add column if not exists min_stay int not null default 1,
  add column if not exists max_stay int not null default 0,
  add column if not exists rack_rate_cents int not null default 0,
  add column if not exists extra_adult_cents int not null default 0,
  add column if not exists extra_child_cents int not null default 0,
  add column if not exists extra_infant_cents int not null default 0,
  add column if not exists included_adults int not null default 2,
  add column if not exists included_children int not null default 0,
  add column if not exists included_infants int not null default 0,
  add column if not exists max_adults int not null default 0,
  add column if not exists max_children int not null default 0,
  add column if not exists max_infants int not null default 0,
  add column if not exists max_occupants int not null default 0,
  add column if not exists adults_required int not null default 1,
  add column if not exists beds jsonb not null default '[]'::jsonb,
  add column if not exists handicap_accessible boolean not null default false,
  add column if not exists accessible_features jsonb not null default '[]'::jsonb,
  add column if not exists features jsonb not null default '[]'::jsonb,
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- @@CHUNK@@
-- Public booking page reads room types (guest-facing details + photo fallback).
drop policy if exists room_types_public_read on public.room_types;
create policy room_types_public_read on public.room_types for select to anon using (true);
