-- SimpleHotelier — properties can write their own cancellation policy text
-- when the preset dropdown options do not fit. Shown on the booking page.
alter table public.tenants
  add column if not exists cancellation_policy_text text;
