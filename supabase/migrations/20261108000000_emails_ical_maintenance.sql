-- SimpleHotelier — guest emails, Airbnb/Vrbo iCal sync, maintenance tickets.
-- Email delivery is handled by Edge Functions (send-email / daily-jobs) over
-- Amazon SES SMTP; this migration only adds tracking + data structures.

-- 1) Email tracking flags + iCal import linkage on reservations.
alter table public.reservations
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists checkin_reminder_sent_at timestamptz,
  add column if not exists checkout_reminder_sent_at timestamptz,
  add column if not exists ical_feed_id uuid,
  add column if not exists ical_uid text;

-- 2) Per-property iCal export token + weekly report marker.
alter table public.tenants
  add column if not exists ical_token text,
  add column if not exists last_weekly_report_at timestamptz;
update public.tenants
  set ical_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  where ical_token is null;

-- @@CHUNK@@
-- 3) External calendar feeds (one per room, e.g. an Airbnb listing calendar).
create table if not exists public.ical_feeds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  source text not null default 'airbnb' check (source in ('airbnb', 'vrbo', 'other')),
  url text not null,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ical_feeds_tenant on public.ical_feeds (tenant_id);

alter table public.reservations drop constraint if exists reservations_ical_feed_fk;
alter table public.reservations
  add constraint reservations_ical_feed_fk
  foreign key (ical_feed_id) references public.ical_feeds (id) on delete cascade;
create unique index if not exists idx_res_ical_uid
  on public.reservations (ical_feed_id, ical_uid) where ical_feed_id is not null;

-- 4) Maintenance tickets.
create table if not exists public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete set null,
  title text not null,
  description text,
  photo_url text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_maint_tenant on public.maintenance_tickets (tenant_id, status);

drop trigger if exists trg_ical_feeds_updated on public.ical_feeds;
create trigger trg_ical_feeds_updated before update on public.ical_feeds
  for each row execute function public.set_updated_at();
drop trigger if exists trg_maintenance_tickets_updated on public.maintenance_tickets;
create trigger trg_maintenance_tickets_updated before update on public.maintenance_tickets
  for each row execute function public.set_updated_at();

alter table public.ical_feeds enable row level security;
alter table public.maintenance_tickets enable row level security;
drop policy if exists ical_feeds_member_all on public.ical_feeds;
create policy ical_feeds_member_all on public.ical_feeds
  for all to authenticated
  using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));
drop policy if exists maintenance_member_all on public.maintenance_tickets;
create policy maintenance_member_all on public.maintenance_tickets
  for all to authenticated
  using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id));

-- @@CHUNK@@
-- 5) Cron secret store (service-role only; no RLS policies = no client access).
create table if not exists public.system_config (
  key text primary key,
  value text not null
);
alter table public.system_config enable row level security;
insert into public.system_config (key, value)
values ('daily_jobs_secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- @@CHUNK@@
-- 6) Daily scheduler: reminders, iCal sync, Monday weekly report (13:15 UTC).
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
  perform cron.unschedule('simplehotelier-daily-jobs');
exception when others then null;
end $$;
select cron.schedule('simplehotelier-daily-jobs', '15 13 * * *', $$
  select net.http_post(
    url := 'https://ybgmwyzizacxkfgxmroy.supabase.co/functions/v1/daily-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.system_config where key = 'daily_jobs_secret')
    ),
    body := '{}'::jsonb
  );
$$);
