-- SimpleHotelier — what each team role can see and change inside a property.
-- Before: every member had full read/write on every property table (the
-- *_member_all policies), so a cleaner could read guest details, mark a
-- booking paid or change room prices.
-- Now:
--   owner, admin   everything: rates, taxes, room types, add-ons, rooms,
--                  calendar feeds, invites and settings (as before)
--   staff          front desk: reservations, guests, payments (through the
--                  payment functions), housekeeping and maintenance
--   cleaner        housekeeping: room status and notes, the turnover list
--                  (housekeeping_turnovers), maintenance tickets
--   maintenance    (new) maintenance tickets and the room list
-- Payments: browsers can no longer change reservations.paid_cents or write
-- transactions directly. record_manual_payment, the Stripe webhook and the
-- payment functions are the only paths, so every movement is logged.
-- Apply BEFORE deploying the dashboard that reads the member's role (the
-- current dashboard keeps working for owners and admins).
--   node scripts/apply-sql.mjs supabase/migrations/20261122000000_role_scoped_access.sql

-- @@CHUNK@@
-- ---------------------------------------------------------------- roles
alter table public.tenant_members drop constraint if exists tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check
  check (role in ('owner', 'admin', 'staff', 'cleaner', 'maintenance'));
alter table public.invites drop constraint if exists invites_role_check;
alter table public.invites add constraint invites_role_check
  check (role in ('owner', 'admin', 'staff', 'cleaner', 'maintenance'));

-- @@CHUNK@@
-- ---------------------------------------------------------------- front desk data
-- Reservations, guests, folios, booked add-ons: owner/admin/staff. Only
-- owners and admins delete (cancelling is a status change).
do $$
declare t text;
begin
  foreach t in array array['reservations', 'guests', 'folio_entries', 'reservation_addons'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_front_desk_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_front_desk_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_front_desk_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_delete', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']))$p$, t || '_front_desk_read', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']))$p$, t || '_front_desk_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']))
      with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']))$p$, t || '_front_desk_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (public.has_tenant_role(tenant_id, array['owner', 'admin']))$p$, t || '_manager_delete', t);
  end loop;
end $$;

-- Money: the front desk reads payments; nobody writes them from a browser.
drop policy if exists transactions_member_all on public.transactions;
drop policy if exists transactions_front_desk_read on public.transactions;
create policy transactions_front_desk_read on public.transactions for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']));

create or replace function public.reservations_money_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Security-definer payment functions, the webhook and jobs run as other roles.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if (tg_op = 'INSERT' and coalesce(new.paid_cents, 0) <> 0)
     or (tg_op = 'UPDATE' and new.paid_cents is distinct from old.paid_cents) then
    raise exception 'payments_locked' using errcode = '42501',
      detail = 'Record payments and refunds with the payment tools so each one is logged.';
  end if;
  return new;
end $$;
drop trigger if exists trg_reservations_money_guard on public.reservations;
create trigger trg_reservations_money_guard before insert or update on public.reservations
  for each row execute function public.reservations_money_guard();

-- @@CHUNK@@
-- ---------------------------------------------------------------- pricing + setup data
-- Room types (rates, rate plans and promo codes), add-ons, taxes, date
-- overrides and calendar feeds: the front desk reads, owners/admins change.
do $$
declare
  t text;
  old_name text;
begin
  foreach t in array array['room_types', 'addons', 'tax_rules', 'room_rate_overrides', 'ical_feeds'] loop
    old_name := case t when 'room_rate_overrides' then 'rate_overrides_member_all' else t || '_member_all' end;
    execute format('drop policy if exists %I on public.%I', old_name, t);
    execute format('drop policy if exists %I on public.%I', t || '_front_desk_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_write', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']))$p$, t || '_front_desk_read', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (public.has_tenant_role(tenant_id, array['owner', 'admin']))
      with check (public.has_tenant_role(tenant_id, array['owner', 'admin']))$p$, t || '_manager_write', t);
  end loop;
end $$;

-- @@CHUNK@@
-- ---------------------------------------------------------------- rooms
-- Everyone on the team sees the room list. Owners/admins edit rooms; staff
-- may change status, housekeeping status and notes; cleaners housekeeping
-- status and notes. Any column added later is owner/admin-only by default.
drop policy if exists rooms_member_all on public.rooms;
drop policy if exists rooms_member_read on public.rooms;
drop policy if exists rooms_manager_insert on public.rooms;
drop policy if exists rooms_manager_delete on public.rooms;
drop policy if exists rooms_team_update on public.rooms;
create policy rooms_member_read on public.rooms for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy rooms_manager_insert on public.rooms for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy rooms_manager_delete on public.rooms for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']));
create policy rooms_team_update on public.rooms for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff', 'cleaner']))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff', 'cleaner']));

create or replace function public.rooms_role_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_free text[];
begin
  if current_user not in ('anon', 'authenticated')
     or public.has_tenant_role(old.tenant_id, array['owner', 'admin']) then
    return new;
  end if;
  v_free := case when public.has_tenant_role(old.tenant_id, array['staff'])
                 then array['status', 'housekeeping_status', 'notes', 'updated_at']
                 else array['housekeeping_status', 'notes', 'updated_at'] end;
  if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'rooms_locked' using errcode = '42501',
      detail = 'Only owners and admins can change room details.';
  end if;
  return new;
end $$;
drop trigger if exists trg_rooms_role_guard on public.rooms;
create trigger trg_rooms_role_guard before update on public.rooms
  for each row execute function public.rooms_role_guard();

-- @@CHUNK@@
-- ---------------------------------------------------------------- maintenance
-- The whole team reports and works tickets; cleaners can't delete them.
drop policy if exists maintenance_member_all on public.maintenance_tickets;
drop policy if exists maintenance_member_read on public.maintenance_tickets;
drop policy if exists maintenance_member_insert on public.maintenance_tickets;
drop policy if exists maintenance_member_update on public.maintenance_tickets;
drop policy if exists maintenance_team_delete on public.maintenance_tickets;
create policy maintenance_member_read on public.maintenance_tickets for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy maintenance_member_insert on public.maintenance_tickets for insert to authenticated
  with check (public.is_tenant_member(tenant_id));
create policy maintenance_member_update on public.maintenance_tickets for update to authenticated
  using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
create policy maintenance_team_delete on public.maintenance_tickets for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff', 'maintenance']));

-- ---------------------------------------------------------------- invites
-- Invite links are join tokens: only the people who send them see them.
drop policy if exists invites_member_read on public.invites;
drop policy if exists invites_manager_read on public.invites;
create policy invites_manager_read on public.invites for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']));

-- @@CHUNK@@
-- ---------------------------------------------------------------- turnover list
-- Housekeeping's view of upcoming stays: room, dates, status and head count,
-- with no guest names, contact details or money. p_from is the caller's
-- local "today"; at most 14 days.
create or replace function public.housekeeping_turnovers(p_tenant uuid, p_from date, p_days int default 2)
returns table (room_id uuid, check_in date, check_out date, status text, adults int, children int, infants int)
language sql stable security definer set search_path = public as $$
  select r.room_id, r.check_in, r.check_out, r.status, r.adults, r.children, r.infants
  from public.reservations r
  where public.has_tenant_role(p_tenant, array['owner', 'admin', 'staff', 'cleaner'])
    and r.tenant_id = p_tenant
    and r.room_id is not null
    and r.status in ('pending', 'confirmed', 'checked_in', 'checked_out')
    and (r.check_in between p_from and p_from + least(greatest(coalesce(p_days, 2), 1), 14) - 1
         or r.check_out between p_from and p_from + least(greatest(coalesce(p_days, 2), 1), 14) - 1)
  order by least(r.check_in, r.check_out), r.room_id
$$;
revoke execute on function public.housekeeping_turnovers(uuid, date, int) from public, anon;
grant execute on function public.housekeeping_turnovers(uuid, date, int) to authenticated, service_role;

notify pgrst, 'reload schema';
