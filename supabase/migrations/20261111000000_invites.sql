-- SimpleHotelier — team invites. Invites are stored per property with a role
-- and a token; the invitee creates a normal free account (no property, no
-- card/trial) and is joined to the property on first sign-in, matched by the
-- token and their account email. Sending + accepting run through Edge
-- Functions with the service role; members can view/revoke pending invites.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  role text not null default 'cleaner' check (role in ('owner', 'admin', 'staff', 'cleaner')),
  token uuid not null default gen_random_uuid(),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create index if not exists idx_invites_tenant on public.invites (tenant_id, accepted_at);
create unique index if not exists idx_invites_pending_email
  on public.invites (tenant_id, lower(email)) where accepted_at is null;
create index if not exists idx_invites_token on public.invites (token);

alter table public.invites enable row level security;
drop policy if exists invites_member_read on public.invites;
create policy invites_member_read on public.invites
  for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists invites_member_delete on public.invites;
create policy invites_member_delete on public.invites
  for delete to authenticated using (public.is_tenant_member(tenant_id));
