-- SimpleHotelier — invited teammates set a password and are in.
-- The invite link was emailed to them, so it already proves the inbox: the
-- accept-invite function creates the account confirmed (no second
-- "verify your email" step). It needs to know whether an account already
-- exists for the invited email, and whether that account was ever confirmed.
-- Service role only.
--   node scripts/apply-sql.mjs supabase/migrations/20261128000000_invite_signup.sql

create or replace function public.auth_user_by_email(p_email text)
returns table (id uuid, confirmed boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email_confirmed_at is not null
  from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, '')))
  limit 1
$$;
revoke execute on function public.auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_by_email(text) to service_role;

notify pgrst, 'reload schema';
