-- SimpleHotelier — hero image focus point (percent, 0-100) for the booking
-- page hero. Chosen in the Booking Page studio by clicking/dragging on the
-- image; saved with Publish changes; the guest page uses it as the hero's
-- background-position so the important part of the photo stays in frame.
-- Apply any time: older clients simply ignore the new columns.
--   node scripts/apply-sql.mjs supabase/migrations/20261114000000_hero_focus.sql

alter table public.tenants add column if not exists hero_focus_x int not null default 50;
alter table public.tenants add column if not exists hero_focus_y int not null default 50;

grant select (hero_focus_x, hero_focus_y) on public.tenants to anon;

notify pgrst, 'reload schema';
