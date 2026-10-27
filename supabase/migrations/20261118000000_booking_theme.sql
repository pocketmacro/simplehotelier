-- SimpleHotelier — booking page themes: fonts, colors, corners, wording.
-- Set in the Booking Page studio, read by the public booking page (anon).
-- js/booking-theme.js applies only allowlisted fonts and #rrggbb colors, so
-- the stored JSON can never inject CSS; this constraint just keeps it small.
-- Apply BEFORE deploying the site that reads it:
--   node scripts/apply-sql.mjs supabase/migrations/20261118000000_booking_theme.sql

alter table public.tenants
  add column if not exists booking_theme jsonb not null default '{}'::jsonb;
alter table public.tenants drop constraint if exists tenants_booking_theme_shape;
alter table public.tenants add constraint tenants_booking_theme_shape
  check (jsonb_typeof(booking_theme) = 'object' and pg_column_size(booking_theme) < 4096);

grant select (booking_theme) on public.tenants to anon;

notify pgrst, 'reload schema';
