-- SimpleHotelier — a booking the guest has paid for is confirmed.
-- A pending booking (a request waiting on the property) becomes confirmed the
-- moment money or a card arrives: a deposit or payment-link payment, a card
-- saved to guarantee it, or a payment the front desk charges or records.
-- Only that change confirms it, so the front desk can still set a paid booking
-- back to pending by hand. Bookings already paid or guaranteed are confirmed
-- here too. Nothing is emailed from the database.
--   node scripts/apply-sql.mjs supabase/migrations/20261202000000_paid_bookings_confirmed.sql

-- @@CHUNK@@
create or replace function public.reservations_confirm_when_paid()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'pending'
     and (coalesce(new.paid_cents, 0) > coalesce(old.paid_cents, 0)
          or (old.stripe_payment_method_id is null and new.stripe_payment_method_id is not null)) then
    new.status := 'confirmed';
  end if;
  return new;
end $$;
drop trigger if exists trg_reservations_confirm_when_paid on public.reservations;
create trigger trg_reservations_confirm_when_paid before update on public.reservations
  for each row execute function public.reservations_confirm_when_paid();

-- @@CHUNK@@
update public.reservations
  set status = 'confirmed'
  where status = 'pending' and (paid_cents > 0 or stripe_payment_method_id is not null);
