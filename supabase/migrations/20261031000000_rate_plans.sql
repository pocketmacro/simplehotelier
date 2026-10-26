-- SimpleHotelier — per-type rate plans (e.g. Extended stay -10%, min 3 / max 30 nights,
-- optional release period, per-plan extra-guest rates and occupancy overrides,
-- optionally unlocked only by a promo code). Stored as a JSONB array on room_types;
-- prices inside rate plans are plain dollar numbers (guest-facing modifiers of the
-- room's nightly rate), unlike the *_cents columns used for base amounts.
alter table public.room_types
  add column if not exists rate_plans jsonb not null default '[]'::jsonb;
