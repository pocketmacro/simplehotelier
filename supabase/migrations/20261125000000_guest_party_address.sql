-- SimpleHotelier — guests describe their party and (optionally) their address.
-- 1. Party: quote_stay() prices adults, children and infants. Included
--    places go to adults first, then children; extra adults pay the extra-
--    adult rate per person per night, extra children the child rate (the
--    adult rate when none is set), infants only an infant rate. It also
--    enforces the room type's and property's adult/child/infant limits.
--    Fixes: the extra charge used to be one rate per night however many
--    extra guests there were, and the per-category limits were never applied.
-- 2. Address: tenants.guest_address_mode (off / optional / required) decides
--    whether the booking page asks for a home address; create_booking()
--    stores it on the reservation (the editor's address fields).
-- 3. create_booking() stores adults, children and infants separately;
--    staff_quote()/save_reservation() price infants too.
-- Apply BEFORE deploying the create-booking function and site that send them.
--   node scripts/apply-sql.mjs supabase/migrations/20261125000000_guest_party_address.sql

-- @@CHUNK@@
alter table public.tenants add column if not exists guest_address_mode text not null default 'off';
alter table public.tenants drop constraint if exists tenants_guest_address_mode_check;
alter table public.tenants add constraint tenants_guest_address_mode_check check (guest_address_mode in ('off', 'optional', 'required'));
-- The booking page reads these (anon has column-level access to tenants).
grant select (guest_address_mode, maximum_adults, maximum_children, maximum_infants) on public.tenants to anon;
grant select (guest_address_mode) on public.tenants to authenticated;

-- @@CHUNK@@
drop function if exists public.quote_stay(uuid, uuid, date, date, int, uuid[], text, text, boolean, int, date, date, numeric);
create or replace function public.quote_stay(
  p_tenant uuid, p_room uuid, p_check_in date, p_check_out date,
  p_guests int, p_addon_ids uuid[], p_promo text,
  p_plan text default null,            -- staff: 'standard' or a rate plan id; null = best eligible
  p_staff boolean default false,       -- staff: stay rules become warnings
  p_discount_cents int default 0,      -- staff: off the room total, before tax
  p_keep_from date default null,       -- staff: nights in [keep_from, keep_to) keep this rate
  p_keep_to date default null,
  p_keep_rate numeric default null,
  p_children int default null,         -- of p_guests, how many are children (null = all adults)
  p_infants int default 0              -- not counted in p_guests or occupancy limits
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.tenants%rowtype;
  v_r public.rooms%rowtype;
  v_ty public.room_types%rowtype;
  v_has_type boolean := false;
  v_n int;
  v_guests int := coalesce(p_guests, 1);
  v_promo text := upper(btrim(coalesce(p_promo, '')));
  v_base numeric;
  v_floor numeric := 0;
  v_rates numeric[] := '{}';
  v_day date;
  v_ov public.room_rate_overrides%rowtype;
  v_cap int;
  v_plan jsonb;
  v_best jsonb;
  v_best_rates numeric[];
  v_best_sum numeric;
  v_adj numeric[];
  v_sum numeric;
  v_diff numeric;
  v_lim numeric;
  v_lead int;
  v_included numeric;
  v_extra_guests int;
  v_extra_rate numeric := 0;
  v_subtotal numeric;
  v_discount numeric := 0;
  v_extras numeric := 0;
  v_extra_person numeric := 0;
  v_tax numeric := 0;
  v_amt numeric;
  v_addon_lines jsonb := '[]'::jsonb;
  v_tax_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_closed boolean := false;
  v_addon record;
  v_rule record;
  v_total numeric;
  v_dep_pct int := 0;
  v_dep numeric := 0;
  v_final numeric[];
  i int;
  v_children int := greatest(0, coalesce(p_children, 0));
  v_infants int := greatest(0, coalesce(p_infants, 0));
  v_adults int;
  v_req int;
  v_lim_a int;
  v_lim_c int;
  v_lim_i int;
  v_extra_adults int := 0;
  v_extra_children int := 0;
  v_extra_infants int := 0;
  v_free_children int := 0;
  v_child_rate numeric := 0;
  v_infant_rate numeric := 0;
  v_per_night numeric := 0;
begin
  select * into v_t from public.tenants where id = p_tenant;
  if not found then
    return jsonb_build_object('error', 'property_not_found', 'message', 'We could not find this property.');
  end if;
  select * into v_r from public.rooms where id = p_room and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('error', 'room_not_found', 'message', 'That room is no longer listed.');
  end if;
  if v_r.room_type_id is not null then
    select * into v_ty from public.room_types where id = v_r.room_type_id and tenant_id = p_tenant;
    v_has_type := found;
  end if;

  v_n := p_check_out - p_check_in;
  if v_n is null or v_n < 1 or v_n > 365 then
    return jsonb_build_object('error', 'invalid_dates', 'message', 'Check-out must be after check-in (at most 365 nights).');
  end if;
  if v_guests < 1 or v_guests > 50 then
    return jsonb_build_object('error', 'invalid_guests', 'message', 'Please choose between 1 and 50 guests.');
  end if;
  v_adults := v_guests - v_children;
  if v_adults < 1 or v_infants > 20 then
    return jsonb_build_object('error', 'invalid_guests', 'message', 'Every booking needs at least one adult.');
  end if;
  if v_has_type and coalesce(v_ty.min_stay, 0) > 0 and v_n < v_ty.min_stay then
    if not p_staff then
      return jsonb_build_object('error', 'min_stay', 'message', format('This room type needs at least %s nights.', v_ty.min_stay));
    end if;
    v_warnings := v_warnings || to_jsonb(format('Shorter than the %s-night minimum for this room type.', v_ty.min_stay));
  end if;
  if v_has_type and coalesce(v_ty.max_stay, 0) > 0 and v_n > v_ty.max_stay then
    if not p_staff then
      return jsonb_build_object('error', 'max_stay', 'message', format('This room type allows at most %s nights online.', v_ty.max_stay));
    end if;
    v_warnings := v_warnings || to_jsonb(format('Longer than the %s-night maximum for this room type.', v_ty.max_stay));
  end if;

  v_base := case when v_has_type and coalesce(v_ty.rack_rate_cents, 0) > 0
                 then v_ty.rack_rate_cents / 100.0 else coalesce(v_r.rate_cents, 0) / 100.0 end;
  if coalesce(v_t.min_room_rate_cents, 0) <> 0 then v_floor := v_t.min_room_rate_cents / 100.0; end if;
  v_day := p_check_in;
  while v_day < p_check_out loop
    v_ov := null;
    if v_r.room_type_id is not null then
      select * into v_ov from public.room_rate_overrides o where o.room_type_id = v_r.room_type_id and o.date = v_day;
    end if;
    if v_ov.id is not null and v_ov.closed then
      if not p_staff then
        return jsonb_build_object('error', 'closed', 'message', 'This room is closed for part of this stay. Try different dates.');
      end if;
      v_closed := true;
    end if;
    v_rates := v_rates || greatest(v_floor, case when v_ov.id is not null then v_ov.rate_cents / 100.0 else v_base end);
    v_day := v_day + 1;
  end loop;
  if v_closed then
    v_warnings := v_warnings || to_jsonb('Includes nights closed in the Rate Calendar.'::text);
  end if;

  if v_r.room_type_id is not null then
    v_ov := null;
    select * into v_ov from public.room_rate_overrides o where o.room_type_id = v_r.room_type_id and o.date = p_check_in;
    if v_ov.id is not null and v_ov.cta then
      if not p_staff then
        return jsonb_build_object('error', 'no_arrival', 'message', 'This room does not accept arrivals on your check-in date.');
      end if;
      v_warnings := v_warnings || to_jsonb('Check-in date is closed to arrival.'::text);
    end if;
    if v_ov.id is not null and coalesce(v_ov.min_stay, 0) > 0 and v_n < v_ov.min_stay then
      if not p_staff then
        return jsonb_build_object('error', 'min_stay', 'message', format('This stay needs at least %s nights from that check-in date.', v_ov.min_stay));
      end if;
      v_warnings := v_warnings || to_jsonb(format('Shorter than the %s-night minimum for that check-in date.', v_ov.min_stay));
    end if;
    if v_ov.id is not null and coalesce(v_ov.max_stay, 0) > 0 and v_n > v_ov.max_stay then
      if not p_staff then
        return jsonb_build_object('error', 'max_stay', 'message', format('This stay allows at most %s nights from that check-in date.', v_ov.max_stay));
      end if;
      v_warnings := v_warnings || to_jsonb(format('Longer than the %s-night maximum for that check-in date.', v_ov.max_stay));
    end if;
    v_ov := null;
    select * into v_ov from public.room_rate_overrides o where o.room_type_id = v_r.room_type_id and o.date = p_check_out;
    if v_ov.id is not null and v_ov.ctd then
      if not p_staff then
        return jsonb_build_object('error', 'no_departure', 'message', 'This room does not accept departures on your check-out date.');
      end if;
      v_warnings := v_warnings || to_jsonb('Check-out date is closed to departure.'::text);
    end if;
  end if;

  if coalesce(v_t.maximum_total_occupants, 0) > 0 then v_cap := v_t.maximum_total_occupants; end if;
  if v_has_type and coalesce(v_ty.max_occupants, 0) > 0 then v_cap := least(coalesce(v_cap, v_ty.max_occupants), v_ty.max_occupants); end if;
  if v_cap is not null and v_guests > v_cap then
    if not p_staff then
      return jsonb_build_object('error', 'too_many_guests', 'message', format('This booking allows at most %s total occupants.', v_cap));
    end if;
    v_warnings := v_warnings || to_jsonb(format('More than the %s-guest maximum.', v_cap));
  end if;

  -- Adults, children and infants: the room type's limits and the property's
  -- (0 = no limit), plus the adults a room type requires.
  v_req := case when v_has_type then greatest(1, coalesce(v_ty.adults_required, 1)) else 1 end;
  if v_adults < v_req then
    if not p_staff then
      return jsonb_build_object('error', 'too_few_adults', 'message', format('This room needs at least %s adults.', v_req));
    end if;
    v_warnings := v_warnings || to_jsonb(format('Fewer than the %s adults this room requires.', v_req));
  end if;
  v_lim_a := least(nullif(case when v_has_type then v_ty.max_adults end, 0), nullif(v_t.maximum_adults, 0));
  v_lim_c := least(nullif(case when v_has_type then v_ty.max_children end, 0), nullif(v_t.maximum_children, 0));
  v_lim_i := least(nullif(case when v_has_type then v_ty.max_infants end, 0), nullif(v_t.maximum_infants, 0));
  if v_lim_a is not null and v_adults > v_lim_a then
    if not p_staff then
      return jsonb_build_object('error', 'too_many_adults', 'message', format('This booking allows at most %s adults.', v_lim_a));
    end if;
    v_warnings := v_warnings || to_jsonb(format('More than the %s-adult maximum.', v_lim_a));
  end if;
  if v_lim_c is not null and v_children > v_lim_c then
    if not p_staff then
      return jsonb_build_object('error', 'too_many_children', 'message', format('This booking allows at most %s children.', v_lim_c));
    end if;
    v_warnings := v_warnings || to_jsonb(format('More than the %s-child maximum.', v_lim_c));
  end if;
  if v_lim_i is not null and v_infants > v_lim_i then
    if not p_staff then
      return jsonb_build_object('error', 'too_many_infants', 'message', format('This booking allows at most %s infants.', v_lim_i));
    end if;
    v_warnings := v_warnings || to_jsonb(format('More than the %s-infant maximum.', v_lim_i));
  end if;

  -- Rate plan: staff may pick one ('standard' = none); guests get the best eligible.
  select coalesce(sum(u.val), 0) into v_best_sum from unnest(v_rates) as u(val);
  v_lead := p_check_in - current_date;
  if v_has_type and jsonb_typeof(v_ty.rate_plans) = 'array' and coalesce(p_plan, '') <> 'standard' then
    for v_plan in select e.value from jsonb_array_elements(v_ty.rate_plans) as e loop
      continue when jsonb_typeof(v_plan) <> 'object';
      if p_plan is not null then
        continue when coalesce(v_plan ->> 'id', '') <> p_plan;
      else
        v_lim := public.sh_jsonb_num(v_plan, 'minStay');
        continue when coalesce(v_lim, 0) <> 0 and v_n < v_lim;
        v_lim := public.sh_jsonb_num(v_plan, 'maxStay');
        continue when coalesce(v_lim, 0) <> 0 and v_n > v_lim;
        v_lim := public.sh_jsonb_num(v_plan, 'releasePeriod');
        continue when coalesce(v_lim, 0) <> 0 and v_lead < v_lim;
        continue when coalesce(v_plan ->> 'promoCode', '') <> '' and upper(v_plan ->> 'promoCode') <> v_promo;
      end if;
      v_diff := coalesce(public.sh_jsonb_num(v_plan, 'difference'), 0);
      select array_agg(case when v_plan ->> 'rateKind' = 'flat'
                            then greatest(0, round(u.val + v_diff, 2))
                            else greatest(0, round(u.val * (1 + v_diff / 100), 2)) end order by u.ord)
        into v_adj from unnest(v_rates) with ordinality as u(val, ord);
      select coalesce(sum(u.val), 0) into v_sum from unnest(v_adj) as u(val);
      if p_plan is not null or v_sum < v_best_sum - 0.001 then
        v_best_sum := v_sum; v_best := v_plan; v_best_rates := v_adj;
      end if;
      exit when p_plan is not null;
    end loop;
  end if;

  -- "Keep rates for existing dates": nights already on the booking keep the
  -- rate the guest was quoted; only new nights use today's rates.
  v_final := coalesce(v_best_rates, v_rates);
  if p_keep_rate is not null and p_keep_from is not null and p_keep_to is not null then
    for i in 1 .. array_length(v_final, 1) loop
      if p_check_in + (i - 1) >= p_keep_from and p_check_in + (i - 1) < p_keep_to then
        v_final[i] := round(p_keep_rate, 2);
      end if;
    end loop;
  end if;

  if v_best is not null and public.sh_jsonb_num(v_best, 'includedOccupants') is not null then
    v_included := public.sh_jsonb_num(v_best, 'includedOccupants');
  elsif v_has_type and v_ty.included_adults is not null then
    v_included := v_ty.included_adults;
  else
    v_included := coalesce(v_t.included_occupants, 2);
  end if;
  if v_best is not null and coalesce(public.sh_jsonb_num(v_best, 'extraAdultRate'), 0) <> 0 then
    v_extra_rate := public.sh_jsonb_num(v_best, 'extraAdultRate');
  elsif v_has_type and coalesce(v_ty.extra_adult_cents, 0) <> 0 then
    v_extra_rate := v_ty.extra_adult_cents / 100.0;
  end if;
  -- Included places go to adults first, then children. Each extra adult pays
  -- the extra-adult rate per night; each extra child the child rate (the
  -- adult rate when none is set); infants pay only when an infant rate is set.
  v_extra_adults := greatest(0, v_adults - v_included)::int;
  v_free_children := greatest(0, v_included - v_adults)::int
    + case when v_has_type then greatest(0, coalesce(v_ty.included_children, 0)) else 0 end;
  v_extra_children := greatest(0, v_children - v_free_children);
  v_extra_infants := greatest(0, v_infants - case when v_has_type then greatest(0, coalesce(v_ty.included_infants, 0)) else 0 end);
  v_child_rate := case
    when v_best is not null and coalesce(public.sh_jsonb_num(v_best, 'extraChildRate'), 0) > 0 then public.sh_jsonb_num(v_best, 'extraChildRate')
    when v_has_type and coalesce(v_ty.extra_child_cents, 0) > 0 then v_ty.extra_child_cents / 100.0
    else v_extra_rate end;
  v_infant_rate := case
    when v_best is not null and coalesce(public.sh_jsonb_num(v_best, 'extraInfantRate'), 0) > 0 then public.sh_jsonb_num(v_best, 'extraInfantRate')
    when v_has_type and coalesce(v_ty.extra_infant_cents, 0) > 0 then v_ty.extra_infant_cents / 100.0
    else 0 end;
  v_per_night := v_extra_adults * v_extra_rate + v_extra_children * v_child_rate + v_extra_infants * v_infant_rate;
  v_extra_guests := v_extra_adults + v_extra_children + case when v_infant_rate > 0 then v_extra_infants else 0 end;

  for v_addon in
    select a.id, a.name, a.price_cents, a.per from public.addons a
    where a.tenant_id = p_tenant and a.id = any (coalesce(p_addon_ids, '{}'::uuid[]))
      and (a.active or p_staff)
    order by a.name
  loop
    v_amt := round(v_addon.price_cents / 100.0
                   * case v_addon.per when 'night' then v_n when 'person' then v_guests else 1 end, 2);
    v_extras := v_extras + v_amt;
    v_addon_lines := v_addon_lines || jsonb_build_object('addon_id', v_addon.id, 'name', v_addon.name,
      'price_cents', v_addon.price_cents, 'amount_cents', round(v_amt * 100)::int);
  end loop;
  if v_per_night > 0 then
    v_extra_person := round(v_per_night * v_n, 2);
    v_addon_lines := v_addon_lines || jsonb_build_object('name', format('Extra guests × %s', v_extra_guests),
      'amount_cents', round(v_extra_person * 100)::int);
  end if;
  v_extras := round(v_extras, 2);

  select round(coalesce(sum(u.val), 0), 2) into v_subtotal from unnest(v_final) as u(val);
  v_discount := least(v_subtotal, greatest(0, coalesce(p_discount_cents, 0)) / 100.0);
  for v_rule in
    select tr.name, tr.kind, tr.rate, tr.applies_to from public.tax_rules tr
    where tr.tenant_id = p_tenant and tr.active order by tr.sort_order
  loop
    if v_rule.kind = 'percent' then
      v_amt := round((case when coalesce(v_rule.applies_to, '') ~* 'room only' then v_subtotal - v_discount
                           else v_subtotal - v_discount + v_extras + v_extra_person end)
                     * coalesce(v_rule.rate, 0) / 100, 2);
    else
      v_amt := round(coalesce(v_rule.rate, 0) * v_n, 2);
    end if;
    v_tax := v_tax + v_amt;
    v_tax_lines := v_tax_lines || jsonb_build_object('name', v_rule.name, 'amount_cents', round(v_amt * 100)::int);
  end loop;
  v_tax := round(v_tax, 2);
  v_total := round(v_subtotal - v_discount + v_extras + v_extra_person + v_tax, 2);

  if v_t.deposit_enabled then
    v_dep_pct := least(100, greatest(1, coalesce(nullif(v_t.deposit_percent, 0), 25)));
    v_dep := round(v_total * v_dep_pct / 100, 2);
  end if;

  return jsonb_build_object(
    'room_id', v_r.id, 'room_code', v_r.code, 'room_name', v_r.name, 'room_type_id', v_r.room_type_id,
    'nights', v_n, 'guests', v_guests, 'adults', v_adults, 'children', v_children, 'infants', v_infants,
    'nightly_cents', (select jsonb_agg(round(u.val * 100)::int order by u.ord) from unnest(v_final) with ordinality as u(val, ord)),
    'plan_id', v_best ->> 'id',
    'plan_name', v_best ->> 'name',
    'subtotal_cents', round(v_subtotal * 100)::int,
    'discount_cents', round(v_discount * 100)::int,
    'extras_cents', round(v_extras * 100)::int,
    'extra_person_cents', round(v_extra_person * 100)::int,
    'addons_cents', round((v_extras + v_extra_person) * 100)::int,
    'tax_cents', round(v_tax * 100)::int,
    'total_cents', round(v_total * 100)::int,
    'addon_lines', v_addon_lines,
    'tax_lines', v_tax_lines,
    'warnings', v_warnings,
    'deposit_percent', v_dep_pct,
    'deposit_cents', round(v_dep * 100)::int,
    'deposit_collectible', coalesce(v_t.deposit_enabled, false)
                           and coalesce(v_t.stripe_onboarding_complete, false)
                           and v_t.stripe_account_id is not null
  );
end $$;

revoke execute on function public.quote_stay(uuid, uuid, date, date, int, uuid[], text, text, boolean, int, date, date, numeric, int, int) from public, anon, authenticated;
grant execute on function public.quote_stay(uuid, uuid, date, date, int, uuid[], text, text, boolean, int, date, date, numeric, int, int) to service_role;

-- @@CHUNK@@
drop function if exists public.staff_quote(uuid, uuid, date, date, int, int, uuid[], text, int, uuid, boolean);
create or replace function public.staff_quote(
  p_tenant uuid, p_room uuid, p_check_in date, p_check_out date,
  p_adults int default 2, p_children int default 0,
  p_addon_ids uuid[] default '{}', p_plan text default null, p_discount_cents int default 0,
  p_reservation uuid default null, p_keep_rates boolean default false,
  p_infants int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_old public.reservations%rowtype;
  v_keep_rate numeric;
begin
  if not public.has_tenant_role(p_tenant, array['owner', 'admin', 'staff']) then
    raise exception 'not_allowed' using errcode = '42501', detail = 'Only the front desk team can price reservations.';
  end if;
  if p_keep_rates and p_reservation is not null then
    select * into v_old from public.reservations where id = p_reservation and tenant_id = p_tenant;
    if found and v_old.check_out > v_old.check_in and v_old.subtotal_cents > 0 then
      v_keep_rate := v_old.subtotal_cents / 100.0 / (v_old.check_out - v_old.check_in);
    end if;
  end if;
  return public.quote_stay(p_tenant, p_room, p_check_in, p_check_out,
    greatest(1, coalesce(p_adults, 1)) + greatest(0, coalesce(p_children, 0)), p_addon_ids, null,
    p_plan, true, coalesce(p_discount_cents, 0), v_old.check_in, v_old.check_out, v_keep_rate,
    greatest(0, coalesce(p_children, 0)), greatest(0, coalesce(p_infants, 0)));
end $$;

revoke execute on function public.staff_quote(uuid, uuid, date, date, int, int, uuid[], text, int, uuid, boolean, int) from public, anon;
grant execute on function public.staff_quote(uuid, uuid, date, date, int, int, uuid[], text, int, uuid, boolean, int) to authenticated, service_role;

-- @@CHUNK@@
create or replace function public.save_reservation(
  p_tenant uuid,
  p_reservation uuid,
  p_room uuid,
  p_check_in date,
  p_check_out date,
  p_guest jsonb,
  p_adults int default 2,
  p_children int default 0,
  p_infants int default 0,
  p_addon_ids uuid[] default '{}',
  p_plan text default null,
  p_discount_cents int default 0,
  p_keep_rates boolean default false,
  p_reprice boolean default true,
  p_status text default 'confirmed',
  p_source text default 'direct',
  p_notes text default null,
  p_staff_notes text default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_old public.reservations%rowtype;
  v_quote jsonb;
  v_name text := btrim(regexp_replace(coalesce(p_guest ->> 'name', ''), '[[:cntrl:]]+', ' ', 'g'));
  v_email text := nullif(lower(btrim(coalesce(p_guest ->> 'email', ''))), '');
  v_id uuid := p_reservation;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_clean jsonb := '{}'::jsonb;
  k text;
begin
  if not public.has_tenant_role(p_tenant, array['owner', 'admin', 'staff']) then
    raise exception 'not_allowed' using errcode = '42501', detail = 'Only the front desk team can edit reservations.';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using detail = 'Add the guest''s name.';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or v_email ~ '[[:cntrl:]<>",;]') then
    raise exception 'invalid_email' using detail = 'Check the guest''s email address.';
  end if;
  if p_status not in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled') then
    raise exception 'invalid_status' using detail = 'Unknown booking status.';
  end if;
  if p_source not in ('direct', 'phone', 'walkin', 'airbnb', 'vrbo', 'other') then
    raise exception 'invalid_source' using detail = 'Unknown booking source.';
  end if;
  if coalesce(p_adults, 0) < 1 or coalesce(p_children, 0) < 0 or coalesce(p_infants, 0) < 0 then
    raise exception 'invalid_guests' using detail = 'At least one adult; counts cannot be negative.';
  end if;
  -- Short single-line contact fields only.
  foreach k in array array['phone', 'address_line1', 'address_line2', 'city', 'state', 'postcode', 'country', 'arrival_time'] loop
    v_clean := v_clean || jsonb_build_object(k, nullif(left(btrim(regexp_replace(coalesce(p_guest ->> k, ''), '[[:cntrl:]]+', ' ', 'g')), 120), ''));
  end loop;

  if v_id is not null then
    select * into v_old from public.reservations where id = v_id and tenant_id = p_tenant for update;
    if not found then
      raise exception 'not_found' using detail = 'That reservation no longer exists.';
    end if;
  end if;

  -- Anything that changes the price always reprices, whatever the client says.
  if v_id is null or p_reprice
     or p_room is distinct from v_old.room_id or p_check_in is distinct from v_old.check_in
     or p_check_out is distinct from v_old.check_out or p_adults is distinct from v_old.adults
     or coalesce(p_children, 0) is distinct from v_old.children
     or coalesce(p_infants, 0) is distinct from coalesce(v_old.infants, 0)
     or coalesce(p_discount_cents, 0) is distinct from v_old.discount_cents then
    v_quote := public.staff_quote(p_tenant, p_room, p_check_in, p_check_out, p_adults, p_children,
                                  p_addon_ids, p_plan, p_discount_cents, v_id, p_keep_rates and v_id is not null,
                                  p_infants => p_infants);
    if v_quote ->> 'error' is not null then
      raise exception '%', v_quote ->> 'error' using detail = v_quote ->> 'message';
    end if;
  end if;

  begin
    if v_id is null then
      for v_attempt in 1..4 loop
        v_code := 'R-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
                           from generate_series(1, 6));
        begin
          insert into public.reservations (tenant_id, room_id, guest_name, confirmation_code, check_in, check_out, status, source)
          values (p_tenant, p_room, v_name, v_code, p_check_in, p_check_out, p_status, p_source)
          returning id into v_id;
          exit;
        exception when unique_violation then
          null;
        end;
      end loop;
    end if;

    update public.reservations set
      room_id = p_room, check_in = p_check_in, check_out = p_check_out,
      status = p_status, source = p_source,
      guest_name = v_name, guest_email = v_email, guest_phone = v_clean ->> 'phone',
      guest_address_line1 = v_clean ->> 'address_line1', guest_address_line2 = v_clean ->> 'address_line2',
      guest_city = v_clean ->> 'city', guest_state = v_clean ->> 'state',
      guest_postcode = v_clean ->> 'postcode', guest_country = v_clean ->> 'country',
      arrival_time = v_clean ->> 'arrival_time',
      adults = p_adults, children = coalesce(p_children, 0), infants = coalesce(p_infants, 0),
      notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 4000),
      staff_notes = left(nullif(btrim(coalesce(p_staff_notes, '')), ''), 4000)
    where id = v_id;

    if v_quote is not null then
      update public.reservations set
        subtotal_cents = (v_quote ->> 'subtotal_cents')::int,
        extras_cents = (v_quote ->> 'extras_cents')::int,
        extra_person_cents = (v_quote ->> 'extra_person_cents')::int,
        discount_cents = (v_quote ->> 'discount_cents')::int,
        tax_cents = (v_quote ->> 'tax_cents')::int,
        total_cents = (v_quote ->> 'total_cents')::int,
        rate_plan_id = v_quote ->> 'plan_id',
        rate_plan_name = v_quote ->> 'plan_name'
      where id = v_id;
      delete from public.reservation_addons where reservation_id = v_id;
      insert into public.reservation_addons (tenant_id, reservation_id, addon_id, name_snapshot, price_cents, qty)
      select p_tenant, v_id, (l ->> 'addon_id')::uuid, l ->> 'name', (l ->> 'price_cents')::int, 1
      from jsonb_array_elements(v_quote -> 'addon_lines') as l
      where l ->> 'addon_id' is not null;
    end if;
  exception when exclusion_violation then
    raise exception 'unavailable' using detail = 'That room is already booked for some of those dates. Pick another room or dates.';
  end;

  return (select to_jsonb(r) from public.reservations r where r.id = v_id)
         || jsonb_build_object('quote', v_quote);
end $$;

revoke execute on function public.save_reservation(uuid, uuid, uuid, date, date, jsonb, int, int, int, uuid[], text, int, boolean, boolean, text, text, text, text) from public, anon;
grant execute on function public.save_reservation(uuid, uuid, uuid, date, date, jsonb, int, int, int, uuid[], text, int, boolean, boolean, text, text, text, text) to authenticated, service_role;

-- @@CHUNK@@
drop function if exists public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text, text);
create or replace function public.create_booking(
  p_tenant uuid,
  p_check_in date,
  p_check_out date,
  p_name text,
  p_email text,
  p_room uuid default null,
  p_room_type uuid default null,
  p_guests int default 2,
  p_phone text default null,
  p_requests text default null,
  p_addon_ids uuid[] default '{}',
  p_promo text default null,
  p_marketing_consent boolean default false,
  p_terms_accepted boolean default false,
  p_client_ip text default null,         -- set by the create-booking function (service role only)
  p_arrival_time text default null,      -- one of the reservation editor's arrival windows
  p_children int default 0,              -- of p_guests, how many are children
  p_infants int default 0,               -- in addition to p_guests
  p_guest_address jsonb default null     -- {line1, line2, city, state, postcode, country}
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant public.tenants%rowtype;
  -- Names and phones end up in email subjects/headers: no control characters.
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := nullif(btrim(regexp_replace(coalesce(p_phone, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  v_requests text := left(nullif(btrim(coalesce(p_requests, '')), ''), 1000);
  v_promo text := nullif(upper(btrim(coalesce(p_promo, ''))), '');
  v_terms boolean;
  v_card boolean;
  v_headers json;
  v_ip text := '';
  v_ip_hash text;
  v_unit record;
  v_quote jsonb;
  v_first_error jsonb;
  v_quoted boolean := false;
  v_tried int := 0;
  v_code text;
  v_res_id uuid;
  v_notes text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_addr jsonb := '{}'::jsonb;
  v_k text;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'invalid_name' using detail = 'Please add your full name.';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or v_email ~ '[[:cntrl:]<>",;]' then
    raise exception 'invalid_email' using detail = 'Please enter a valid email address.';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'invalid_phone' using detail = 'Please check your phone number.';
  end if;
  if p_check_in is null or p_check_out is null
     or p_check_in < current_date - 1 or p_check_in > current_date + 1095 then
    raise exception 'invalid_dates' using detail = 'Please pick a check-in date from today onward.';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant;
  if not found then
    raise exception 'property_not_found' using detail = 'We could not find this property.';
  end if;
  v_terms := btrim(coalesce(v_tenant.rental_terms, '')) <> '';
  -- Home address: only when the property asks for it (Booking Page studio).
  if coalesce(v_tenant.guest_address_mode, 'off') <> 'off' and jsonb_typeof(p_guest_address) = 'object' then
    foreach v_k in array array['line1', 'line2', 'city', 'state', 'postcode', 'country'] loop
      v_addr := v_addr || jsonb_build_object(v_k,
        nullif(left(btrim(regexp_replace(coalesce(p_guest_address ->> v_k, ''), '[[:cntrl:]]+', ' ', 'g')), 120), ''));
    end loop;
  end if;
  if v_tenant.guest_address_mode = 'required'
     and (v_addr ->> 'line1' is null or v_addr ->> 'city' is null or v_addr ->> 'postcode' is null or v_addr ->> 'country' is null) then
    raise exception 'address_required' using detail = 'Please add your street address, city, postal code and country.';
  end if;
  if coalesce(p_children, 0) < 0 or coalesce(p_infants, 0) < 0 or coalesce(p_children, 0) >= coalesce(p_guests, 1) then
    raise exception 'invalid_guests' using detail = 'Every booking needs at least one adult.';
  end if;
  -- Arrival time: the same windows the front desk picks from in the editor.
  if nullif(btrim(coalesce(p_arrival_time, '')), '') is not null
     and btrim(p_arrival_time) <> all (array['Before 12 PM', '12 – 2 PM', '2 – 4 PM', '4 – 6 PM', '6 – 8 PM', 'After 8 PM']) then
    raise exception 'invalid_arrival_time' using detail = 'Please choose an arrival time from the list.';
  end if;

  if v_terms and not coalesce(p_terms_accepted, false) then
    raise exception 'terms_required' using detail = 'Please read and agree to the property''s terms and house rules.';
  end if;
  -- A card can only be taken once the property has finished Stripe setup.
  v_card := coalesce(v_tenant.stripe_onboarding_complete, false) and v_tenant.stripe_account_id is not null;

  perform public.release_abandoned_holds(p_tenant);

  if (select count(*) from public.reservations x
      where x.tenant_id = p_tenant and lower(x.guest_email) = v_email
        and x.status = 'pending' and x.source = 'direct'
        and x.created_at > now() - interval '1 day') >= 3 then
    raise exception 'too_many_requests'
      using detail = 'You already have booking requests waiting with this property. Please wait for them to confirm, or contact the property.';
  end if;
  -- Guest IP for the per-connection throttle: passed by the create-booking
  -- Edge Function (trusted only from the service role), else the request
  -- headers PostgREST saw.
  if p_client_ip is not null and coalesce(auth.role(), '') = 'service_role' then
    v_ip := left(btrim(p_client_ip), 64);
  else
    begin
      v_headers := current_setting('request.headers', true)::json;
      v_ip := btrim(coalesce(v_headers ->> 'cf-connecting-ip',
                             split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''));
    exception when others then
      v_ip := '';
    end;
  end if;
  if v_ip <> '' then
    v_ip_hash := encode(sha256(convert_to(v_ip, 'UTF8')), 'hex');
    delete from public.booking_attempts b where b.created_at < now() - interval '1 day';
    if (select count(*) from public.booking_attempts b
        where b.ip_hash = v_ip_hash and b.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'too_many_requests'
        using detail = 'Too many booking requests from this connection. Please wait a while or contact the property.';
    end if;
  end if;

  for v_unit in
    select r.id from public.rooms r
    where r.tenant_id = p_tenant
      and ((p_room_type is not null and r.room_type_id = p_room_type)
           or (p_room_type is null and r.id = p_room))
    order by r.sort_order, r.code
  loop
    v_tried := v_tried + 1;
    v_quote := public.quote_stay(p_tenant, v_unit.id, p_check_in, p_check_out, p_guests, p_addon_ids, v_promo,
                                 p_children => coalesce(p_children, 0), p_infants => coalesce(p_infants, 0));
    if v_quote ->> 'error' is not null then
      v_first_error := coalesce(v_first_error, v_quote);
      continue;
    end if;
    v_quoted := true;
    continue when exists (
      select 1 from public.reservations x
      where x.room_id = v_unit.id and x.status in ('pending', 'confirmed', 'checked_in')
        and x.stay_range && daterange(p_check_in, p_check_out, '[)'));

    v_notes := concat_ws(' · ',
      v_requests,
      (select 'Add-ons: ' || string_agg(l ->> 'name', ', ')
         from jsonb_array_elements(v_quote -> 'addon_lines') as l where l ->> 'addon_id' is not null),
      'Rate plan: ' || (v_quote ->> 'plan_name'),
      'Promo code: ' || v_promo,
      case when coalesce(p_marketing_consent, false) and v_tenant.gdpr_consent then 'Marketing consent: yes' end,
      case when v_terms then 'Guest agreed to property terms & house rules' end,
      case when (v_quote ->> 'deposit_cents')::int > 0 then
        format('Deposit %s: $%s (%s%%)',
          case when (v_quote ->> 'deposit_collectible')::boolean then 'to pay by card'
               else 'acknowledged, to be collected by property' end,
          to_char((v_quote ->> 'deposit_cents')::int / 100.0, 'FM999,999,990.00'),
          v_quote ->> 'deposit_percent')
      end);

    v_res_id := null;
    for v_attempt in 1..4 loop
      v_code := 'SH-' || (select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
                           from generate_series(1, 6));
      begin
        insert into public.reservations (
          tenant_id, room_id, guest_name, guest_email, guest_phone, confirmation_code,
          check_in, check_out, status, source, adults, notes,
          subtotal_cents, extras_cents, extra_person_cents, tax_cents, total_cents, paid_cents,
          rate_plan_id, rate_plan_name, card_required, arrival_time, children, infants,
          guest_address_line1, guest_address_line2, guest_city, guest_state, guest_postcode, guest_country)
        values (
          p_tenant, v_unit.id, v_name, v_email, v_phone, v_code,
          p_check_in, p_check_out, 'pending', 'direct', (v_quote ->> 'adults')::int, nullif(v_notes, ''),
          (v_quote ->> 'subtotal_cents')::int, (v_quote ->> 'extras_cents')::int, (v_quote ->> 'extra_person_cents')::int,
          (v_quote ->> 'tax_cents')::int, (v_quote ->> 'total_cents')::int, 0,
          v_quote ->> 'plan_id', v_quote ->> 'plan_name', v_card, nullif(btrim(coalesce(p_arrival_time, '')), ''),
          (v_quote ->> 'children')::int, (v_quote ->> 'infants')::int,
          v_addr ->> 'line1', v_addr ->> 'line2', v_addr ->> 'city', v_addr ->> 'state', v_addr ->> 'postcode', v_addr ->> 'country')
        returning id into v_res_id;
        exit;
      exception
        when exclusion_violation then
          exit; -- this unit was just taken: try the next one
        when unique_violation then
          null; -- confirmation code collision: new code
      end;
    end loop;
    exit when v_res_id is not null;
  end loop;

  if v_res_id is null then
    if v_tried = 0 then
      raise exception 'room_not_found' using detail = 'That room is no longer listed. Please pick another.';
    elsif not v_quoted then
      raise exception '%', v_first_error ->> 'error' using detail = v_first_error ->> 'message';
    end if;
    raise exception 'unavailable'
      using detail = 'Those dates just became unavailable. Try different dates or another room.';
  end if;

  insert into public.reservation_addons (tenant_id, reservation_id, addon_id, name_snapshot, price_cents, qty)
  select p_tenant, v_res_id, (l ->> 'addon_id')::uuid, l ->> 'name', (l ->> 'price_cents')::int, 1
  from jsonb_array_elements(v_quote -> 'addon_lines') as l
  where l ->> 'addon_id' is not null;

  if v_ip_hash is not null then
    insert into public.booking_attempts (ip_hash, tenant_id) values (v_ip_hash, p_tenant);
  end if;

  return v_quote || jsonb_build_object('reservation_id', v_res_id, 'confirmation_code', v_code, 'card_required', v_card);
end $$;

revoke execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text, text, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text, text, int, int, jsonb) to service_role;

notify pgrst, 'reload schema';
