-- SimpleHotelier — daily limit on Spark (support-ai), a paid external API.
-- Signups are free, so without a cap any account could run up model costs.
-- Apply BEFORE deploying the matching support-ai function:
--   node scripts/apply-sql.mjs supabase/migrations/20261119000000_ai_usage_limit.sql

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  questions int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security; -- no policies: service role only
revoke all on public.ai_usage from anon, authenticated;

-- Count one question and return today's total (atomic under concurrency).
create or replace function public.bump_ai_usage(p_user uuid)
returns int
language sql volatile security definer set search_path = public as $$
  insert into public.ai_usage as u (user_id, day, questions)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update set questions = u.questions + 1
  returning questions
$$;

revoke execute on function public.bump_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid) to service_role;

notify pgrst, 'reload schema';
