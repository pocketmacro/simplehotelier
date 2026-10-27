-- SimpleHotelier — Support is for the people who run the property.
-- Support cases (help with SimpleHotelier itself) are for owners, admins and
-- the front desk; housekeeping and maintenance have no access (their
-- dashboard has no Support screen). Replaces the "own cases" rule from
-- 20261123000000_security_cleanup.
--   node scripts/apply-sql.mjs supabase/migrations/20261128000100_support_front_desk.sql

create or replace function public.can_see_support_case(p_case uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.support_cases c
    where c.id = p_case and (
      public.is_system_admin()
      or public.has_tenant_role(c.tenant_id, array['owner', 'admin', 'staff'])))
$$;

drop policy if exists cases_read on public.support_cases;
drop policy if exists cases_insert on public.support_cases;
drop policy if exists cases_update on public.support_cases;
create policy cases_read on public.support_cases for select to authenticated
  using (public.is_system_admin() or public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']));
create policy cases_insert on public.support_cases for insert to authenticated
  with check (public.is_system_admin()
              or (public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']) and user_id = auth.uid()));
create policy cases_update on public.support_cases for update to authenticated
  using (public.is_system_admin() or public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']))
  with check (public.is_system_admin() or public.has_tenant_role(tenant_id, array['owner', 'admin', 'staff']));

notify pgrst, 'reload schema';
