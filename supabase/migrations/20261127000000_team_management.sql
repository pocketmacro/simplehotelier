-- SimpleHotelier — see and manage the people on a property's team.
-- 1. team_members(): the team with names and login emails for owners and
--    admins (browsers can't read auth.users). Everyone else gets nothing.
-- 2. A property always keeps an owner: removing or demoting the last owner
--    from a browser is refused (deleting the whole property still works).
-- Role changes and removals use tenant_members directly, under the existing
-- policies (owners manage anyone; admins manage everyone but owners and
-- can't make owners; anyone may leave).
--   node scripts/apply-sql.mjs supabase/migrations/20261127000000_team_management.sql

create or replace function public.team_members(p_tenant uuid)
returns table (user_id uuid, role text, email text, name text, joined_at timestamptz, is_me boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, u.email::text,
         nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ''),
         m.created_at, m.user_id = auth.uid()
  from public.tenant_members m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant
    and public.has_tenant_role(p_tenant, array['owner', 'admin'])
  order by case m.role when 'owner' then 0 when 'admin' then 1 when 'staff' then 2 when 'cleaner' then 3 else 4 end, u.email
$$;
revoke execute on function public.team_members(uuid) from public, anon;
grant execute on function public.team_members(uuid) to authenticated, service_role;

create or replace function public.tenant_members_keep_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') or old.role <> 'owner'
     or (tg_op = 'UPDATE' and new.role = 'owner') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- The property itself is being deleted (cascade): nothing to keep.
  if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  if not exists (select 1 from public.tenant_members m
                 where m.tenant_id = old.tenant_id and m.role = 'owner' and m.id <> old.id) then
    raise exception 'last_owner' using errcode = '23514',
      detail = 'A property needs at least one owner. Make someone else an owner first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_tenant_members_keep_owner on public.tenant_members;
create trigger trg_tenant_members_keep_owner before update or delete on public.tenant_members
  for each row execute function public.tenant_members_keep_owner();

notify pgrst, 'reload schema';
