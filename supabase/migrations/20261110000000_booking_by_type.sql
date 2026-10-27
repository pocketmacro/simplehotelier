-- SimpleHotelier — properties choose how guests book: by room type
-- (system auto-assigns an available unit at booking) or by specific room.
-- Default: by room type, matching type-level pricing.
alter table public.tenants
  add column if not exists booking_by_type boolean not null default true;
