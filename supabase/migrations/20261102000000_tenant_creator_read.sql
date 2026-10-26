-- SimpleHotelier — let a creator read the property they just created.
-- createProperty inserts with Prefer: return=representation; Postgres requires
-- the new row to also pass a SELECT policy. Until the owner membership row is
-- inserted (the very next call), tenants_member_all cannot match, so every
-- first-time property creation failed with an RLS error.
drop policy if exists tenants_creator_read on public.tenants;
create policy tenants_creator_read on public.tenants
  for select to authenticated
  using (created_by = auth.uid());
