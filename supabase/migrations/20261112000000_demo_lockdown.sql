-- SimpleHotelier — lock down anonymous reads (demo isolation).
-- Apply AFTER the site deploy that ships the matching js/book.js column
-- lists (deploy first, then apply): older clients used select=* on tenants
-- and rooms, which stops working once anon loses full-column access.
--   node scripts/apply-sql.mjs supabase/migrations/20261112000000_demo_lockdown.sql
--
-- Why: tenants_public_read (row-level, using true) plus a table-wide anon
-- SELECT grant meant anyone with the public publishable key could dump
-- every tenant row including ical_token (which unlocks the iCal export of
-- reservation dates/confirmation codes), Stripe customer/subscription ids,
-- tax numbers and private notification emails. RLS is row-level only, so
-- the fix is column-level grants for anon: the public booking page keeps
-- exactly the profile/pricing columns it displays, nothing else.
-- Rooms had the same shape: internal notes/housekeeping state were
-- anonymously readable; anon now gets booking fields only.
-- Members (authenticated) are untouched and keep full access to their rows.

revoke select on public.tenants from anon;
grant select (
  id, name, slug, contact_email, phone, logo_url, brand_color,
  booking_headline, booking_subheading, description,
  address_line1, address_line2, postcode, city, state, country,
  website_url, facebook_url, instagram_url, twitter_url, youtube_url,
  star_rated, star_count, gdpr_consent,
  check_in_time, check_out_time, cancellation_policy, cancellation_policy_text,
  rental_terms, currency, stripe_account_id, stripe_onboarding_complete,
  ga_measurement_id, booking_redirect_url,
  deposit_enabled, deposit_percent, booking_by_type,
  included_occupants, maximum_total_occupants, min_room_rate_cents
) on public.tenants to anon;

-- @@CHUNK@@
revoke select on public.rooms from anon;
grant select (
  id, tenant_id, room_type_id, code, name, sleeps,
  rate_cents, weekend_rate_cents, photos, sort_order
) on public.rooms to anon;

-- @@CHUNK@@
-- Every existing ical_token was anonymously readable until now, so treat
-- them all as compromised and rotate. Owners must paste the fresh feed
-- URL (Settings -> External calendars) into Airbnb/Vrbo once; the app
-- already shows the current token there. Until then those calendars
-- pause — deliberately, rather than keep leaking booking data.
update public.tenants
set ical_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where ical_token is not null;

notify pgrst, 'reload schema';
