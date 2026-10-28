-- SimpleHotelier — availability, rates and inventory (ARI) per night, the
-- shape channels like Google Hotels take.
-- ari_snapshot(tenant, from, to) returns one product per room type (plus one
-- per room without a type), and for each night in [from, to): units free,
-- the standard nightly rate, and the Rate Calendar's restrictions.
-- The nightly rate is quote_stay()'s, night by night: the Rate Calendar
-- override, else the type's rack rate, else the rate of the unit
-- create_booking() would pick (first free by sort order), never below the
-- property's minimum. tests/rls/checks.sql R107 proves it matches
-- quote_stay(). Rate plans without a promo code are passed through as stored;
-- they are stay-level (min/max stay, release period), so the feed applies them.
-- "Free" counts units free that night. A multi-night stay also needs one unit
-- free for every night (no room moves), as create_booking() requires.
-- Internal: service role only (the channel push job).
--   node scripts/apply-sql.mjs supabase/migrations/20261201000000_ari_snapshot.sql

-- @@CHUNK@@
create or replace function public.ari_snapshot(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.tenants%rowtype;
  v_floor int;
  v_cap int;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > 731 then
    raise exception 'invalid_dates' using detail = 'Ask for 1 to 731 nights.';
  end if;
  select * into v_t from public.tenants where id = p_tenant;
  if not found then
    raise exception 'property_not_found' using detail = 'We could not find this property.';
  end if;
  v_floor := greatest(0, coalesce(v_t.min_room_rate_cents, 0));
  v_cap := nullif(v_t.maximum_total_occupants, 0);

  return jsonb_build_object(
    'tenant_id', v_t.id,
    'slug', v_t.slug,
    'currency', coalesce(v_t.currency, 'USD'),
    'card_fee_mode', v_t.card_fee_mode,
    'from', p_from,
    'to', p_to,
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object('name', tr.name, 'kind', tr.kind, 'rate', tr.rate, 'applies_to', tr.applies_to)
                       order by tr.sort_order)
      from public.tax_rules tr where tr.tenant_id = p_tenant and tr.active), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(p.product order by p.name, p.id)
      from (
        -- Room types with at least one unit.
        select ty.id, ty.name, jsonb_build_object(
          'room_type_id', ty.id,
          'room_id', null,
          'name', ty.name,
          'units', (select count(*) from public.rooms r where r.room_type_id = ty.id and r.tenant_id = p_tenant),
          'max_occupants', least(v_cap, nullif(ty.max_occupants, 0)),
          'included_occupants', coalesce(ty.included_adults, v_t.included_occupants, 2),
          'extra_adult_cents', coalesce(ty.extra_adult_cents, 0),
          'extra_child_cents', coalesce(ty.extra_child_cents, 0),
          'extra_infant_cents', coalesce(ty.extra_infant_cents, 0),
          'min_stay', nullif(ty.min_stay, 0),
          'max_stay', nullif(ty.max_stay, 0),
          'rate_plans', coalesce((
            select jsonb_agg(e.p order by e.ord)
            from jsonb_array_elements(case when jsonb_typeof(ty.rate_plans) = 'array' then ty.rate_plans else '[]'::jsonb end)
                 with ordinality as e(p, ord)
            where jsonb_typeof(e.p) = 'object' and coalesce(e.p ->> 'promoCode', '') = ''), '[]'::jsonb),
          'nights', (
            select jsonb_agg(jsonb_build_object(
              'date', g.d,
              'free', u.free,
              'rate_cents', greatest(v_floor, coalesce(o.rate_cents,
                              case when coalesce(ty.rack_rate_cents, 0) > 0 then ty.rack_rate_cents else coalesce(u.unit_rate, 0) end)),
              'closed', coalesce(o.closed, false),
              'cta', coalesce(o.cta, false),
              'ctd', coalesce(o.ctd, false),
              'min_stay', nullif(o.min_stay, 0),
              'max_stay', nullif(o.max_stay, 0)) order by g.d)
            from (select p_from + i as d from generate_series(0, p_to - p_from - 1) as i) g
            left join public.room_rate_overrides o on o.room_type_id = ty.id and o.date = g.d
            cross join lateral (
              select (count(*) filter (where not s.busy))::int as free,
                     (array_agg(s.rate_cents order by s.busy, s.sort_order, s.code))[1] as unit_rate
              from (
                select r.rate_cents, r.sort_order, r.code, exists (
                  select 1 from public.reservations x
                  where x.room_id = r.id and x.status in ('pending', 'confirmed', 'checked_in')
                    and x.stay_range @> g.d) as busy
                from public.rooms r where r.room_type_id = ty.id and r.tenant_id = p_tenant
              ) s
            ) u)
        ) as product
        from public.room_types ty
        where ty.tenant_id = p_tenant
          and exists (select 1 from public.rooms r where r.room_type_id = ty.id and r.tenant_id = p_tenant)
        union all
        -- Rooms without a type: one unit each, the room's own rate, no calendar overrides.
        select r.id, r.name, jsonb_build_object(
          'room_type_id', null,
          'room_id', r.id,
          'name', r.name,
          'units', 1,
          'max_occupants', v_cap,
          'included_occupants', coalesce(v_t.included_occupants, 2),
          'extra_adult_cents', 0,
          'extra_child_cents', 0,
          'extra_infant_cents', 0,
          'min_stay', null,
          'max_stay', null,
          'rate_plans', '[]'::jsonb,
          'nights', (
            select jsonb_agg(jsonb_build_object(
              'date', g.d,
              'free', case when exists (
                        select 1 from public.reservations x
                        where x.room_id = r.id and x.status in ('pending', 'confirmed', 'checked_in')
                          and x.stay_range @> g.d) then 0 else 1 end,
              'rate_cents', greatest(v_floor, coalesce(r.rate_cents, 0)),
              'closed', false, 'cta', false, 'ctd', false, 'min_stay', null, 'max_stay', null) order by g.d)
            from (select p_from + i as d from generate_series(0, p_to - p_from - 1) as i) g)
        ) as product
        from public.rooms r
        where r.tenant_id = p_tenant and r.room_type_id is null
      ) p), '[]'::jsonb)
  );
end $$;

revoke execute on function public.ari_snapshot(uuid, date, date) from public, anon, authenticated;
grant execute on function public.ari_snapshot(uuid, date, date) to service_role;
