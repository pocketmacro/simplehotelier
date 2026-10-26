-- SimpleHotelier — property-wide occupancy limits and defaults.
-- These are counts of people, not ages. Room types and rate plans may be
-- more specific; the booking page also uses maximum_total_occupants as a cap.
alter table public.tenants
  add column if not exists included_occupants int not null default 2,
  add column if not exists maximum_adults int,
  add column if not exists maximum_children int,
  add column if not exists maximum_infants int,
  add column if not exists maximum_total_occupants int;
