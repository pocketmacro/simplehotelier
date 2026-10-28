-- SimpleHotelier — booked nights for the booking page's calendar.
-- booking_calendar(tenant, from, to) returns each room's busy nights in
-- [from, to) as [check_in, check_out) pairs clipped to the window, counting
-- what get_available_room_ids() counts (pending, confirmed and in-house
-- stays, Airbnb/Vrbo calendar imports included). No guest details: only
-- when a room is taken, which get_available_room_ids() already answers for
-- any dates. The page combines it with the Rate Calendar's public rules
-- (closed, no arrivals/departures, stay limits) to cross out dates.
-- Windows longer than 550 days return nothing.
--   node scripts/apply-sql.mjs supabase/migrations/20261203000000_booking_calendar.sql

-- @@CHUNK@@
create or replace function public.booking_calendar(p_tenant uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('room', r.id, 'busy', coalesce(b.busy, '[]'::jsonb)) order by r.id), '[]'::jsonb)
  from public.rooms r
  left join lateral (
    select jsonb_agg(jsonb_build_array(greatest(lower(res.stay_range), p_from), least(upper(res.stay_range), p_to))
                     order by lower(res.stay_range)) as busy
    from public.reservations res
    where res.room_id = r.id
      and res.status in ('pending', 'confirmed', 'checked_in')
      and res.stay_range && daterange(p_from, p_to, '[)')
  ) b on true
  where r.tenant_id = p_tenant
    and p_from is not null and p_to > p_from and p_to - p_from <= 550
$$;

revoke execute on function public.booking_calendar(uuid, date, date) from public;
grant execute on function public.booking_calendar(uuid, date, date) to anon, authenticated;
