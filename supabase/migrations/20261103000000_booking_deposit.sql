-- SimpleHotelier — optional booking deposit per property.
-- When enabled, the booking page collects deposit_percent of the total by card
-- (via the property's connected Stripe account) before the booking confirms.
alter table public.tenants
  add column if not exists deposit_enabled boolean not null default false,
  add column if not exists deposit_percent int not null default 25;
