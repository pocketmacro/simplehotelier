-- SimpleHotelier — guests choose an estimated arrival time when they book.
-- create_booking() takes p_arrival_time (one of the reservation editor's
-- windows, or nothing) and stores it in reservations.arrival_time, so it
-- shows in the reservation editor, the reservations list and the emails.
-- Still service_role only (the Turnstile-gated create-booking function).
-- Apply BEFORE deploying the create-booking function that sends it.
--   node scripts/apply-sql.mjs supabase/migrations/20261124000000_booking_arrival_time.sql

-- @@CHUNK@@
drop function if exists public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text);
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
  p_arrival_time text default null       -- one of the reservation editor's arrival windows
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
    v_quote := public.quote_stay(p_tenant, v_unit.id, p_check_in, p_check_out, p_guests, p_addon_ids, v_promo);
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
          rate_plan_id, rate_plan_name, card_required, arrival_time)
        values (
          p_tenant, v_unit.id, v_name, v_email, v_phone, v_code,
          p_check_in, p_check_out, 'pending', 'direct', (v_quote ->> 'guests')::int, nullif(v_notes, ''),
          (v_quote ->> 'subtotal_cents')::int, (v_quote ->> 'extras_cents')::int, (v_quote ->> 'extra_person_cents')::int,
          (v_quote ->> 'tax_cents')::int, (v_quote ->> 'total_cents')::int, 0,
          v_quote ->> 'plan_id', v_quote ->> 'plan_name', v_card, nullif(btrim(coalesce(p_arrival_time, '')), ''))
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

revoke execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean, text, text) to service_role;

notify pgrst, 'reload schema';
