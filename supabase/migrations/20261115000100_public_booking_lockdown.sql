-- SimpleHotelier — security hotfix, part 2 of 2.
-- Apply AFTER part 1 (20261115000000_security_hotfix.sql) AND after the site
-- deploy that ships the matching js/book.js (create_booking + get_rate_plans
-- + explicit room_types columns) and js/app.js (tenant-scoped upload paths):
--   node scripts/apply-sql.mjs supabase/migrations/20261115000100_public_booking_lockdown.sql
--
-- Why:
--  1. reservations_public_request let anon insert any reservation as long as
--     status = 'pending': any tenant, any room, any total/paid amount, any
--     confirmation code (stored XSS) and unlimited inventory holds.
--     reservation_addons_public_insert accepted anything at all. Guests now
--     book only through create_booking(), which prices server-side.
--  2. room_types.rate_plans (with every promo code) was anonymously readable.
--     anon keeps every other room_types column; plans come from
--     get_rate_plans(), which only reveals the code the guest typed.
--  3. Storage: any signed-in user could overwrite any property's photos and
--     logos. Writes are now limited to the caller's own tenant folder
--     ({tenant_id}/...), images only, 10 MB max.

-- @@CHUNK@@
drop policy if exists reservations_public_request on public.reservations;
revoke insert on public.reservations from anon;
drop policy if exists reservation_addons_public_insert on public.reservation_addons;
revoke insert on public.reservation_addons from anon;

-- @@CHUNK@@
revoke select on public.room_types from anon;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'room_types' and column_name <> 'rate_plans';
  execute format('grant select (%s) on public.room_types to anon', cols);
end $$;

-- @@CHUNK@@
drop policy if exists storage_auth_write on storage.objects;
drop policy if exists storage_auth_update on storage.objects;
drop policy if exists storage_tenant_insert on storage.objects;
drop policy if exists storage_tenant_update on storage.objects;
drop policy if exists storage_tenant_delete on storage.objects;

create policy storage_tenant_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('room-photos', 'property-logos')
              and (storage.foldername(name))[1] in (select m::text from public.member_tenant_ids() m));
create policy storage_tenant_update on storage.objects
  for update to authenticated
  using (bucket_id in ('room-photos', 'property-logos')
         and (storage.foldername(name))[1] in (select m::text from public.member_tenant_ids() m))
  with check (bucket_id in ('room-photos', 'property-logos')
              and (storage.foldername(name))[1] in (select m::text from public.member_tenant_ids() m));
create policy storage_tenant_delete on storage.objects
  for delete to authenticated
  using (bucket_id in ('room-photos', 'property-logos')
         and (storage.foldername(name))[1] in (select m::text from public.member_tenant_ids() m));

-- SVG is excluded on purpose: it can carry script when opened directly.
update storage.buckets
  set file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
  where id in ('room-photos', 'property-logos');

notify pgrst, 'reload schema';
