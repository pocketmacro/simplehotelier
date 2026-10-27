-- SimpleHotelier — booking page customization: page background/foreground
-- colors and a hero image, set per property in the Booking Page studio.
-- Apply AFTER the site deploy that ships the matching js/book.js column
-- list (deploy first, then apply), like 20261112000000_demo_lockdown.sql:
--   node scripts/apply-sql.mjs supabase/migrations/20261113000000_booking_customization.sql
-- The new columns are public booking-page data, so anon gets SELECT on
-- exactly these three — nothing else about tenants changes.

alter table public.tenants add column if not exists booking_bg_color text;
alter table public.tenants add column if not exists booking_fg_color text;
alter table public.tenants add column if not exists hero_image_url text;

grant select (booking_bg_color, booking_fg_color, hero_image_url) on public.tenants to anon;

notify pgrst, 'reload schema';
