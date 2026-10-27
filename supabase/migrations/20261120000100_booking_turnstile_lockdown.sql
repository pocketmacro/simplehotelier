-- SimpleHotelier — public bookings go through Cloudflare Turnstile, part 2.
-- Apply AFTER the site that books through the create-booking Edge Function
-- is live: guests (anon) and signed-in users can no longer call
-- create_booking() directly, so every online booking passes the bot check.
--   node scripts/apply-sql.mjs supabase/migrations/20261120000100_booking_turnstile_lockdown.sql

revoke execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text) to service_role;

notify pgrst, 'reload schema';
