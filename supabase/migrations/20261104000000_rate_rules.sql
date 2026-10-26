-- SimpleHotelier — advanced per-date rate rules.
-- room_rate_overrides gains stay limits and stop-sell flags alongside the rate:
-- closed (no stays that night), cta (no arrivals that day), ctd (no departures).
alter table public.room_rate_overrides
  add column if not exists min_stay int,
  add column if not exists max_stay int,
  add column if not exists closed boolean not null default false,
  add column if not exists cta boolean not null default false,
  add column if not exists ctd boolean not null default false;
