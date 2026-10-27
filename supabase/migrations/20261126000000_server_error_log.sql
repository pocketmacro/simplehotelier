-- SimpleHotelier — Edge Function errors join browser errors in Site errors.
-- log_server_error() is called by the functions (service role only) from
-- their error paths: page 'server', source = the function's name. Same
-- table, daily de-duplication, 2000-a-day cap and 30-day pruning as
-- log_client_error() (20261121000000).
--   node scripts/apply-sql.mjs supabase/migrations/20261126000000_server_error_log.sql

create or replace function public.log_server_error(
  p_function text,
  p_message text,
  p_stack text default null,
  p_tenant uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_fn text := left(coalesce(nullif(btrim(p_function), ''), 'unknown'), 60);
  v_msg text := left(btrim(coalesce(p_message, '')), 500);
begin
  if v_msg = '' then
    v_msg := 'Unknown error';
  end if;
  insert into public.client_errors as e (fingerprint, page, message, source, stack, tenant_id)
  select md5('server|' || v_fn || '|' || v_msg), 'server', v_msg, v_fn,
         nullif(left(coalesce(p_stack, ''), 4000), ''), (select t.id from public.tenants t where t.id = p_tenant)
  where (select count(*) from public.client_errors c where c.day = current_date) < 2000
  on conflict (day, fingerprint) do update set count = e.count + 1, last_seen = now();
exception when others then
  return; -- logging must never break the request that failed
end $$;

revoke execute on function public.log_server_error(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_server_error(text, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
