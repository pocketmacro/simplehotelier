-- SimpleHotelier — property-specific guest terms and house rules shown
-- on the public booking page before a guest completes a reservation.
alter table public.tenants
  add column if not exists rental_terms text;
