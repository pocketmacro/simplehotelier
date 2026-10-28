-- SimpleHotelier — properties pay Stripe's card fee, and by default pass it
-- on to the guest (supabase/functions/_shared/card-fee.js has the numbers).
-- 1. tenants.card_fee_mode: 'guest' (default) adds a card processing fee to
--    the guest's payment; 'property' absorbs it (for places where card
--    surcharges aren't allowed). Read by the public booking page.
-- 2. transactions.fee_cents: the guest-paid card fee on a card payment (and,
--    negative, on its refunds). amount_cents stays the part that pays the
--    booking, so balances and reports don't change.
-- 3. transactions.fee_settled_at: daily-jobs compared the application fee
--    with Stripe's actual fee and settled any difference with the property.
-- 4. record_stripe_payment() stores the fee; record_stripe_refund() takes the
--    amount Stripe refunded (booking part + fee share) and splits it.
-- Apply before deploying charge-guest, stripe-webhook and daily-jobs:
--   node scripts/apply-sql.mjs supabase/migrations/20261130000000_card_fees.sql

-- @@CHUNK@@
alter table public.tenants add column if not exists card_fee_mode text not null default 'guest'
  check (card_fee_mode in ('guest', 'property'));
grant select (card_fee_mode) on public.tenants to anon, authenticated;

alter table public.transactions add column if not exists fee_cents int not null default 0;
alter table public.transactions add column if not exists fee_settled_at timestamptz;

-- @@CHUNK@@
-- New trailing parameter: drop the old signature so calls can't be ambiguous.
drop function if exists public.record_stripe_payment(text, uuid, int, text, text);
create or replace function public.record_stripe_payment(
  p_intent text, p_reservation uuid default null, p_amount_cents int default null,
  p_description text default null, p_kind text default null, p_fee_cents int default 0
) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
  v_res_id uuid;
  v_amount int;
  v_res public.reservations%rowtype;
begin
  update public.transactions t set status = 'paid'
    where t.stripe_payment_intent_id = p_intent and t.status <> 'paid'
    returning t.id, t.reservation_id, t.amount_cents into v_id, v_res_id, v_amount;
  if v_id is not null then
    if v_res_id is not null then
      update public.reservations r set paid_cents = r.paid_cents + coalesce(v_amount, 0) where r.id = v_res_id;
    end if;
    return true;
  end if;
  if p_reservation is null or coalesce(p_amount_cents, 0) <= 0 then
    return false;
  end if;
  select * into v_res from public.reservations where id = p_reservation;
  if not found then
    return false;
  end if;
  insert into public.transactions (tenant_id, reservation_id, description, method, status, amount_cents, fee_cents, stripe_payment_intent_id, kind)
  values (v_res.tenant_id, v_res.id, coalesce(p_description, v_res.confirmation_code || ' · Card payment'),
          'card', 'paid', p_amount_cents, greatest(coalesce(p_fee_cents, 0), 0), p_intent, coalesce(p_kind, 'charge'))
  on conflict (stripe_payment_intent_id) where stripe_payment_intent_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    return false; -- already recorded (pending row paid earlier, or a concurrent call)
  end if;
  update public.reservations r set paid_cents = r.paid_cents + p_amount_cents where r.id = v_res.id;
  return true;
end $$;

revoke execute on function public.record_stripe_payment(text, uuid, int, text, text, int) from public, anon, authenticated;
grant execute on function public.record_stripe_payment(text, uuid, int, text, text, int) to service_role;

-- @@CHUNK@@
-- p_amount_cents is what Stripe refunded: the booking part plus that share of
-- the card fee. The booking part comes off paid_cents; the last refund of a
-- payment takes exactly what is left of each.
create or replace function public.record_stripe_refund(p_refund_id text, p_intent text, p_amount_cents int)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_orig public.transactions%rowtype;
  v_new uuid;
  v_done_amt int;
  v_done_fee int;
  v_amt int;
  v_fee int;
begin
  select * into v_orig from public.transactions where stripe_payment_intent_id = p_intent;
  if not found or coalesce(p_amount_cents, 0) <= 0 then
    return false;
  end if;
  select coalesce(-sum(amount_cents), 0), coalesce(-sum(fee_cents), 0) into v_done_amt, v_done_fee
    from public.transactions where kind = 'refund' and parent_id = v_orig.id;
  if coalesce(v_orig.fee_cents, 0) <= 0 then
    v_amt := p_amount_cents;
  elsif v_done_amt + v_done_fee + p_amount_cents >= v_orig.amount_cents + v_orig.fee_cents then
    v_amt := greatest(v_orig.amount_cents - v_done_amt, 0);
  else
    v_amt := round(p_amount_cents::numeric * v_orig.amount_cents / (v_orig.amount_cents + v_orig.fee_cents));
  end if;
  v_amt := least(v_amt, p_amount_cents);
  v_fee := p_amount_cents - v_amt;
  insert into public.transactions (tenant_id, reservation_id, description, method, status, amount_cents, fee_cents, stripe_charge_id, kind, parent_id)
  values (v_orig.tenant_id, v_orig.reservation_id, 'Refund · ' || v_orig.description, 'card', 'refunded',
          -v_amt, -v_fee, p_refund_id, 'refund', v_orig.id)
  on conflict (stripe_charge_id) where kind = 'refund' do nothing
  returning id into v_new;
  if v_new is null then
    return false;
  end if;
  if v_orig.reservation_id is not null then
    update public.reservations set paid_cents = paid_cents - v_amt where id = v_orig.reservation_id;
  end if;
  if v_done_amt + v_amt >= v_orig.amount_cents then
    update public.transactions set status = 'refunded' where id = v_orig.id;
  end if;
  return true;
end $$;

revoke execute on function public.record_stripe_refund(text, text, int) from public, anon, authenticated;
grant execute on function public.record_stripe_refund(text, text, int) to service_role;

notify pgrst, 'reload schema';
