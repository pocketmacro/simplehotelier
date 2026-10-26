/* SimpleHotelier — weekly owner report math. Pure functions, Node-testable.
   All money is integer cents; dates are YYYY-MM-DD strings. */
import { addDaysISO, nightsBetween } from "./ical.js";

const ACTIVE = new Set(["pending", "confirmed", "checked_in", "checked_out"]);

/** Room-nights of a reservation overlapping [start, end). */
export function overlapNights(r, start, end) {
  const s = r.check_in > start ? r.check_in : start;
  const e = r.check_out < end ? r.check_out : end;
  return e > s ? nightsBetween(s, e) : 0;
}

/**
 * computeWeeklyStats({ roomCount, reservations, transactions, weekStart, today, arrivalWindowDays })
 * week is [weekStart, weekStart+7). Revenue = paid transactions in the week,
 * falling back to reservation paid_cents collected in the week when no ledger rows exist.
 */
export function computeWeeklyStats({ roomCount = 0, reservations = [], transactions = [], weekStart, today, arrivalWindowDays = 7 }) {
  const weekEnd = addDaysISO(weekStart, 7);
  const active = reservations.filter((r) => ACTIVE.has(r.status));
  let nights = 0;
  for (const r of active) nights += overlapNights(r, weekStart, weekEnd);
  const possible = Math.max(0, roomCount) * 7;
  const occupancyPct = possible ? Math.round((nights / possible) * 1000) / 10 : 0;

  const paidTxns = transactions.filter((t) => t.status === "paid" && t.created_at && String(t.created_at).slice(0, 10) >= weekStart && String(t.created_at).slice(0, 10) < weekEnd);
  let revenueCents = paidTxns.reduce((sum, t) => sum + (t.amount_cents || 0), 0);
  if (!paidTxns.length) {
    revenueCents = active
      .filter((r) => r.check_in >= weekStart && r.check_in < weekEnd)
      .reduce((sum, r) => sum + Math.min(r.paid_cents || 0, r.total_cents || 0), 0);
  }

  const arrEnd = addDaysISO(today, arrivalWindowDays);
  const arrivals = active
    .filter((r) => r.check_in >= today && r.check_in < arrEnd)
    .sort((a, b) => (a.check_in < b.check_in ? -1 : 1))
    .map((r) => ({ guest: r.guest_name, checkIn: r.check_in, checkOut: r.check_out, code: r.confirmation_code }));
  const departures = active
    .filter((r) => r.check_out >= today && r.check_out < arrEnd)
    .sort((a, b) => (a.check_out < b.check_out ? -1 : 1))
    .map((r) => ({ guest: r.guest_name, checkOut: r.check_out, code: r.confirmation_code }));

  const newBookings = reservations.filter((r) => r.status !== "cancelled" && r.created_at && String(r.created_at).slice(0, 10) >= weekStart && String(r.created_at).slice(0, 10) < weekEnd).length;
  return { weekStart, weekEnd, nightsBooked: nights, possibleNights: possible, occupancyPct, revenueCents, arrivals, departures, newBookings };
}
