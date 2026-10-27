-- SimpleHotelier — security hotfix, part 1 of 2.
-- Safe to apply BEFORE the matching site/function deploy: everything the
-- current client does keeps working. Apply order:
--   1. node scripts/apply-sql.mjs supabase/migrations/20261115000000_security_hotfix.sql
--   2. deploy Edge Functions + the site (new js/book.js calls create_booking)
--   3. node scripts/apply-sql.mjs supabase/migrations/20261115000100_public_booking_lockdown.sql
--
-- Fixes:
--  1. Membership takeover: members_self_insert let any signed-in user add
--     themselves to ANY tenant (with any role, including owner). Now only the
--     creator of a tenant that has no members yet may add their own owner row
--     (createProperty in js/auth.js); every other join goes through the
--     accept-invite Edge Function (service role).
--  2. Roles: owner/admin manage the team, invites and property settings;
--     only an owner can delete the property. Any member (even a cleaner)
--     could do all of that before.
--  3. Billing/system columns on tenants (subscription_status, Stripe ids,
--     plan price, ...) can only be changed by the service role (Edge
--     Functions, webhook). Owners could mark themselves "active" before.
--  4. Server-side booking: create_booking() prices the stay from the
--     property's own rates, overrides, plans, add-ons and taxes, assigns a
--     free unit and inserts the request. The browser's totals, paid amount,
--     tenant/room ids and confirmation code are no longer trusted.
--  5. Promo codes: get_rate_plans() returns only the plans a guest may see
--     (no code, or the exact code they typed) without exposing other codes.
--  6. record_stripe_payment(): atomic "mark paid once" for the webhook and
--     the deposit confirm call (no double counting under concurrency).
--  7. Support: members can no longer post messages as 'admin'.
--  8. Stored XSS hardening: confirmation codes are restricted to a safe
--     alphabet (anon could store HTML in them); iCal feeds must be https.

-- @@CHUNK@@
-- ============================================================ role helpers
create or replace function public.has_tenant_role(p_tenant uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant and user_id = auth.uid() and role = any (p_roles)
  )
$$;

-- True only for the user who created the tenant, while it has no members.
create or replace function public.can_claim_tenant(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tenants t where t.id = p_tenant and t.created_by = auth.uid())
     and not exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant)
$$;

-- @@CHUNK@@
-- ============================================================ tenant_members
drop policy if exists members_self_insert on public.tenant_members;
drop policy if exists members_owner_manage on public.tenant_members;
drop policy if exists members_bootstrap_owner on public.tenant_members;
drop policy if exists members_manage_update on public.tenant_members;
drop policy if exists members_manage_delete on public.tenant_members;

create policy members_bootstrap_owner on public.tenant_members
  for insert to authenticated
  with check (user_id = auth.uid() and role = 'owner' and public.can_claim_tenant(tenant_id));

-- Owners manage everyone; admins manage non-owners and can never grant owner.
create policy members_manage_update on public.tenant_members
  for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner'])
         or (role <> 'owner' and public.has_tenant_role(tenant_id, array['admin'])))
  with check (public.has_tenant_role(tenant_id, array['owner'])
         or (role <> 'owner' and public.has_tenant_role(tenant_id, array['admin'])));

-- Members may leave (except owners); owners/admins remove others as above.
create policy members_manage_delete on public.tenant_members
  for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner'])
         or (role <> 'owner' and (user_id = auth.uid() or public.has_tenant_role(tenant_id, array['admin']))));

-- @@CHUNK@@
-- ============================================================ tenants
drop policy if exists tenants_member_all on public.tenants;
drop policy if exists tenants_member_read on public.tenants;
drop policy if exists tenants_manager_update on public.tenants;
drop policy if exists tenants_owner_delete on public.tenants;

create policy tenants_member_read on public.tenants
  for select to authenticated using (public.is_tenant_member(id));
create policy tenants_manager_update on public.tenants
  for update to authenticated
  using (public.has_tenant_role(id, array['owner', 'admin']))
  with check (public.has_tenant_role(id, array['owner', 'admin']));
create policy tenants_owner_delete on public.tenants
  for delete to authenticated using (public.has_tenant_role(id, array['owner']));
-- tenants_create (insert, created_by = auth.uid()), tenants_creator_read,
-- tenants_admin_read and tenants_public_read are unchanged.

-- Browser roles (anon/authenticated) cannot set billing or system columns.
-- service_role (Edge Functions, webhook) and SQL/migration sessions can.
-- A deny-list trigger rather than column grants, so new settings columns
-- added by later migrations stay writable without extra grants.
create or replace function public.tenants_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_slug_changed boolean := true;
  v_token_changed boolean := false;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_slug_changed := new.slug is distinct from old.slug;
    v_token_changed := new.ical_token is distinct from old.ical_token;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.stripe_account_id := null;
    new.stripe_onboarding_complete := false;
    new.stripe_customer_id := null;
    new.stripe_subscription_id := null;
    new.subscription_status := 'trialing';
    new.current_period_end := null;
    new.plan_price_cents := 3000;
    new.last_weekly_report_at := null;
    new.ical_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  elsif new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.stripe_account_id is distinct from old.stripe_account_id
     or new.stripe_onboarding_complete is distinct from old.stripe_onboarding_complete
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status is distinct from old.subscription_status
     or new.current_period_end is distinct from old.current_period_end
     or new.plan_price_cents is distinct from old.plan_price_cents
     or new.last_weekly_report_at is distinct from old.last_weekly_report_at then
    raise exception 'billing and account fields are managed by SimpleHotelier'
      using errcode = '42501';
  end if;
  -- Slugs become subdomains ({slug}.simplehotelier.com): lowercase DNS
  -- labels only, and never one of our own service names.
  if v_slug_changed then
    if new.slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
       or new.slug = any (array['www', 'app', 'api', 'admin', 'mail', 'email', 'book', 'booking',
                                'support', 'help', 'status', 'blog', 'docs', 'dashboard',
                                'static', 'assets', 'cdn', 'auth', 'billing', 'stripe']) then
      raise exception 'invalid booking page address' using errcode = '22023',
        detail = 'Use lowercase letters, numbers and hyphens.';
    end if;
  end if;
  if v_token_changed and char_length(coalesce(new.ical_token, '')) < 32 then
    raise exception 'calendar token too short' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_tenants_guard on public.tenants;
create trigger trg_tenants_guard before insert or update on public.tenants
  for each row execute function public.tenants_guard();

-- @@CHUNK@@
-- ============================================================ invites + support
drop policy if exists invites_member_delete on public.invites;
drop policy if exists invites_manager_delete on public.invites;
create policy invites_manager_delete on public.invites
  for delete to authenticated using (public.has_tenant_role(tenant_id, array['owner', 'admin']));

drop policy if exists msgs_member_all on public.support_messages;
drop policy if exists msgs_read on public.support_messages;
drop policy if exists msgs_insert on public.support_messages;
drop policy if exists msgs_admin_update on public.support_messages;
drop policy if exists msgs_admin_delete on public.support_messages;
create policy msgs_read on public.support_messages
  for select to authenticated
  using (
    public.is_system_admin()
    or exists (select 1 from public.support_cases c where c.id = case_id and public.is_tenant_member(c.tenant_id))
  );
create policy msgs_insert on public.support_messages
  for insert to authenticated
  with check (
    public.is_system_admin()
    or (sender = 'user'
        and exists (select 1 from public.support_cases c where c.id = case_id and public.is_tenant_member(c.tenant_id)))
  );
create policy msgs_admin_update on public.support_messages
  for update to authenticated using (public.is_system_admin()) with check (public.is_system_admin());
create policy msgs_admin_delete on public.support_messages
  for delete to authenticated using (public.is_system_admin());

-- @@CHUNK@@
-- ============================================================ data shape guards
-- Anonymous booking requests could store HTML in confirmation_code, which the
-- dashboard rendered unescaped. Neutralize any such rows, then enforce.
update public.reservations
  set confirmation_code = 'FIX-' || upper(substr(md5(id::text), 1, 10))
  where confirmation_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$';
alter table public.reservations drop constraint if exists reservations_confirmation_code_format;
alter table public.reservations add constraint reservations_confirmation_code_format
  check (confirmation_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$');

-- The server fetches feed URLs (ical-sync): https only for new/edited feeds.
alter table public.ical_feeds drop constraint if exists ical_feeds_url_https;
alter table public.ical_feeds add constraint ical_feeds_url_https
  check (url ~* '^https://') not valid;

-- @@CHUNK@@
-- ============================================================ booking throttle
-- One row per accepted public booking, keyed by a hash of the caller's IP
-- (never the IP itself). Service-only: RLS on, no policies.
create table if not exists public.booking_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  tenant_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_booking_attempts_ip on public.booking_attempts (ip_hash, created_at);
alter table public.booking_attempts enable row level security;
revoke all on public.booking_attempts from anon, authenticated;

-- jsonb number-or-numeric-string -> numeric (rate plans are stored as JSON).
create or replace function public.sh_jsonb_num(p jsonb, k text)
returns numeric language sql immutable as $$
  select case jsonb_typeof(p -> k)
    when 'number' then (p ->> k)::numeric
    when 'string' then case when btrim(p ->> k) ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p ->> k)::numeric end
  end
$$;

-- @@CHUNK@@
-- ============================================================ server-side quote
-- Mirrors the booking page math in js/book.js (SHBookCalc.quote, rate plans,
-- per-date rules, occupancy caps, deposits) so the guest sees the same total
-- the property is sent. Amounts are dollars rounded to cents at each step,
-- exactly like the page. Returns { error, message } instead of a quote when
-- the stay is not bookable. Internal: called by create_booking only.
create or replace function public.quote_stay(
  p_tenant uuid, p_room uuid, p_check_in date, p_check_out date,
  p_guests int, p_addon_ids uuid[], p_promo text
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
  v_addons numeric := 0;
  v_tax numeric := 0;
  v_amt numeric;
  v_addon_lines jsonb := '[]'::jsonb;
  v_tax_lines jsonb := '[]'::jsonb;
  v_addon record;
  v_rule record;
  v_total numeric;
  v_dep_pct int := 0;
  v_dep numeric := 0;
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
  if v_has_type and coalesce(v_ty.min_stay, 0) > 0 and v_n < v_ty.min_stay then
    return jsonb_build_object('error', 'min_stay', 'message', format('This room type needs at least %s nights.', v_ty.min_stay));
  end if;
  if v_has_type and coalesce(v_ty.max_stay, 0) > 0 and v_n > v_ty.max_stay then
    return jsonb_build_object('error', 'max_stay', 'message', format('This room type allows at most %s nights online.', v_ty.max_stay));
  end if;

  -- Nightly rates: type rate (room rate for untyped rooms), per-date
  -- override when set, never below the property's minimum room rate.
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
      return jsonb_build_object('error', 'closed', 'message', 'This room is closed for part of this stay. Try different dates.');
    end if;
    v_rates := v_rates || greatest(v_floor, case when v_ov.id is not null then v_ov.rate_cents / 100.0 else v_base end);
    v_day := v_day + 1;
  end loop;

  if v_r.room_type_id is not null then
    v_ov := null;
    select * into v_ov from public.room_rate_overrides o where o.room_type_id = v_r.room_type_id and o.date = p_check_in;
    if v_ov.id is not null and v_ov.cta then
      return jsonb_build_object('error', 'no_arrival', 'message', 'This room does not accept arrivals on your check-in date.');
    end if;
    if v_ov.id is not null and coalesce(v_ov.min_stay, 0) > 0 and v_n < v_ov.min_stay then
      return jsonb_build_object('error', 'min_stay', 'message', format('This stay needs at least %s nights from that check-in date.', v_ov.min_stay));
    end if;
    if v_ov.id is not null and coalesce(v_ov.max_stay, 0) > 0 and v_n > v_ov.max_stay then
      return jsonb_build_object('error', 'max_stay', 'message', format('This stay allows at most %s nights from that check-in date.', v_ov.max_stay));
    end if;
    v_ov := null;
    select * into v_ov from public.room_rate_overrides o where o.room_type_id = v_r.room_type_id and o.date = p_check_out;
    if v_ov.id is not null and v_ov.ctd then
      return jsonb_build_object('error', 'no_departure', 'message', 'This room does not accept departures on your check-out date.');
    end if;
  end if;

  if coalesce(v_t.maximum_total_occupants, 0) > 0 then v_cap := v_t.maximum_total_occupants; end if;
  if v_has_type and coalesce(v_ty.max_occupants, 0) > 0 then v_cap := least(coalesce(v_cap, v_ty.max_occupants), v_ty.max_occupants); end if;
  if v_cap is not null and v_guests > v_cap then
    return jsonb_build_object('error', 'too_many_guests', 'message', format('This booking allows at most %s total occupants.', v_cap));
  end if;

  -- Best applicable rate plan (the standard rate is the baseline to beat).
  select coalesce(sum(u.val), 0) into v_best_sum from unnest(v_rates) as u(val);
  v_lead := p_check_in - current_date;
  if v_has_type and jsonb_typeof(v_ty.rate_plans) = 'array' then
    for v_plan in select e.value from jsonb_array_elements(v_ty.rate_plans) as e loop
      continue when jsonb_typeof(v_plan) <> 'object';
      v_lim := public.sh_jsonb_num(v_plan, 'minStay');
      continue when coalesce(v_lim, 0) <> 0 and v_n < v_lim;
      v_lim := public.sh_jsonb_num(v_plan, 'maxStay');
      continue when coalesce(v_lim, 0) <> 0 and v_n > v_lim;
      v_lim := public.sh_jsonb_num(v_plan, 'releasePeriod');
      continue when coalesce(v_lim, 0) <> 0 and v_lead < v_lim;
      continue when coalesce(v_plan ->> 'promoCode', '') <> '' and upper(v_plan ->> 'promoCode') <> v_promo;
      v_diff := coalesce(public.sh_jsonb_num(v_plan, 'difference'), 0);
      select array_agg(case when v_plan ->> 'rateKind' = 'flat'
                            then greatest(0, round(u.val + v_diff, 2))
                            else greatest(0, round(u.val * (1 + v_diff / 100), 2)) end order by u.ord)
        into v_adj from unnest(v_rates) with ordinality as u(val, ord);
      select coalesce(sum(u.val), 0) into v_sum from unnest(v_adj) as u(val);
      if v_sum < v_best_sum - 0.001 then
        v_best_sum := v_sum; v_best := v_plan; v_best_rates := v_adj;
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
  v_extra_guests := greatest(0, v_guests - v_included)::int;
  if v_best is not null and coalesce(public.sh_jsonb_num(v_best, 'extraAdultRate'), 0) <> 0 then
    v_extra_rate := public.sh_jsonb_num(v_best, 'extraAdultRate');
  elsif v_has_type and coalesce(v_ty.extra_adult_cents, 0) <> 0 then
    v_extra_rate := v_ty.extra_adult_cents / 100.0;
  end if;

  for v_addon in
    select a.id, a.name, a.price_cents, a.per from public.addons a
    where a.tenant_id = p_tenant and a.active and a.id = any (coalesce(p_addon_ids, '{}'::uuid[]))
    order by a.name
  loop
    v_amt := round(v_addon.price_cents / 100.0
                   * case v_addon.per when 'night' then v_n when 'person' then v_guests else 1 end, 2);
    v_addons := v_addons + v_amt;
    v_addon_lines := v_addon_lines || jsonb_build_object('addon_id', v_addon.id, 'name', v_addon.name,
      'price_cents', v_addon.price_cents, 'amount_cents', round(v_amt * 100)::int);
  end loop;
  if v_extra_guests > 0 and v_extra_rate > 0 then
    v_amt := round(v_extra_rate * v_n, 2);
    v_addons := v_addons + v_amt;
    v_addon_lines := v_addon_lines || jsonb_build_object('name', format('Extra guests × %s', v_extra_guests),
      'amount_cents', round(v_amt * 100)::int);
  end if;
  v_addons := round(v_addons, 2);

  select round(coalesce(sum(u.val), 0), 2) into v_subtotal from unnest(coalesce(v_best_rates, v_rates)) as u(val);
  for v_rule in
    select tr.name, tr.kind, tr.rate, tr.applies_to from public.tax_rules tr
    where tr.tenant_id = p_tenant and tr.active order by tr.sort_order
  loop
    if v_rule.kind = 'percent' then
      v_amt := round((case when coalesce(v_rule.applies_to, '') ~* 'room only' then v_subtotal else v_subtotal + v_addons end)
                     * coalesce(v_rule.rate, 0) / 100, 2);
    else
      v_amt := round(coalesce(v_rule.rate, 0) * v_n, 2);
    end if;
    v_tax := v_tax + v_amt;
    v_tax_lines := v_tax_lines || jsonb_build_object('name', v_rule.name, 'amount_cents', round(v_amt * 100)::int);
  end loop;
  v_tax := round(v_tax, 2);
  v_total := round(v_subtotal + v_addons + v_tax, 2);

  if v_t.deposit_enabled then
    v_dep_pct := least(100, greatest(1, coalesce(nullif(v_t.deposit_percent, 0), 25)));
    v_dep := round(v_total * v_dep_pct / 100, 2);
  end if;

  return jsonb_build_object(
    'room_id', v_r.id, 'room_code', v_r.code, 'room_name', v_r.name, 'room_type_id', v_r.room_type_id,
    'nights', v_n, 'guests', v_guests,
    'plan_name', v_best ->> 'name',
    'subtotal_cents', round(v_subtotal * 100)::int,
    'addons_cents', round(v_addons * 100)::int,
    'tax_cents', round(v_tax * 100)::int,
    'total_cents', round(v_total * 100)::int,
    'addon_lines', v_addon_lines,
    'tax_lines', v_tax_lines,
    'deposit_percent', v_dep_pct,
    'deposit_cents', round(v_dep * 100)::int,
    'deposit_collectible', coalesce(v_t.deposit_enabled, false)
                           and coalesce(v_t.stripe_onboarding_complete, false)
                           and v_t.stripe_account_id is not null
  );
end $$;

revoke execute on function public.quote_stay(uuid, uuid, date, date, int, uuid[], text) from public, anon, authenticated;

-- @@CHUNK@@
-- ============================================================ public booking
-- The only way a guest creates a reservation. Raises with message = an error
-- code (unavailable, too_many_requests, terms_required, invalid_email, ...)
-- and detail = a sentence the booking page can show.
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
  p_terms_accepted boolean default false
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
  if v_terms and not coalesce(p_terms_accepted, false) then
    raise exception 'terms_required' using detail = 'Please read and agree to the property''s terms and house rules.';
  end if;

  -- Throttle: pending requests hold inventory, so cap them per guest email
  -- per property and per caller IP (hashed) across all properties.
  if (select count(*) from public.reservations x
      where x.tenant_id = p_tenant and lower(x.guest_email) = v_email
        and x.status = 'pending' and x.source = 'direct'
        and x.created_at > now() - interval '1 day') >= 3 then
    raise exception 'too_many_requests'
      using detail = 'You already have booking requests waiting with this property. Please wait for them to confirm, or contact the property.';
  end if;
  begin
    v_headers := current_setting('request.headers', true)::json;
    v_ip := btrim(coalesce(v_headers ->> 'cf-connecting-ip',
                           split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1), ''));
  exception when others then
    v_ip := '';
  end;
  if v_ip <> '' then
    v_ip_hash := encode(sha256(convert_to(v_ip, 'UTF8')), 'hex');
    delete from public.booking_attempts b where b.created_at < now() - interval '1 day';
    if (select count(*) from public.booking_attempts b
        where b.ip_hash = v_ip_hash and b.created_at > now() - interval '1 hour') >= 10 then
      raise exception 'too_many_requests'
        using detail = 'Too many booking requests from this connection. Please wait a while or contact the property.';
    end if;
  end if;

  -- Candidate units: every unit of the chosen type in display order (first
  -- free one wins), or the one specific room.
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
          subtotal_cents, tax_cents, total_cents, paid_cents)
        values (
          p_tenant, v_unit.id, v_name, v_email, v_phone, v_code,
          p_check_in, p_check_out, 'pending', 'direct', (v_quote ->> 'guests')::int, nullif(v_notes, ''),
          (v_quote ->> 'subtotal_cents')::int, (v_quote ->> 'tax_cents')::int, (v_quote ->> 'total_cents')::int, 0)
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

  return v_quote || jsonb_build_object('reservation_id', v_res_id, 'confirmation_code', v_code);
end $$;

revoke execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean) from public;
grant execute on function public.create_booking(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid[], text, boolean, boolean) to anon, authenticated;

-- @@CHUNK@@
-- ============================================================ guest-visible rate plans
-- Plans without a promo code, plus the plan(s) matching the code the guest
-- typed. Other codes never leave the database (see part 2, which removes
-- anon read access to room_types.rate_plans).
create or replace function public.get_rate_plans(p_tenant uuid, p_promo text default null)
returns table (room_type_id uuid, rate_plans jsonb)
language sql stable security definer set search_path = public as $$
  select rt.id,
    coalesce((
      select jsonb_agg(case when coalesce(e.p ->> 'promoCode', '') = '' then e.p
                            else e.p || jsonb_build_object('promoCode', upper(btrim(p_promo))) end
                       order by e.ord)
      from jsonb_array_elements(case when jsonb_typeof(rt.rate_plans) = 'array' then rt.rate_plans else '[]'::jsonb end)
           with ordinality as e(p, ord)
      where coalesce(e.p ->> 'promoCode', '') = ''
         or (btrim(coalesce(p_promo, '')) <> '' and upper(e.p ->> 'promoCode') = upper(btrim(p_promo)))
    ), '[]'::jsonb)
  from public.room_types rt
  where rt.tenant_id = p_tenant
$$;

revoke execute on function public.get_rate_plans(uuid, text) from public;
grant execute on function public.get_rate_plans(uuid, text) to anon, authenticated;

-- @@CHUNK@@
-- ============================================================ payments
-- Mark a Stripe payment paid exactly once and add it to the reservation in
-- one statement each, under the row lock: concurrent webhook + confirm calls
-- cannot double count. Service role only.
create or replace function public.record_stripe_payment(p_intent text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_txn record;
begin
  update public.transactions t set status = 'paid'
    where t.stripe_payment_intent_id = p_intent and t.status <> 'paid'
    returning t.id, t.reservation_id, t.amount_cents into v_txn;
  if not found then
    return false;
  end if;
  if v_txn.reservation_id is not null then
    update public.reservations r set paid_cents = r.paid_cents + coalesce(v_txn.amount_cents, 0)
      where r.id = v_txn.reservation_id;
  end if;
  return true;
end $$;

revoke execute on function public.record_stripe_payment(text) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(text) to service_role;

notify pgrst, 'reload schema';
