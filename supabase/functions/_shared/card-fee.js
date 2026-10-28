/* SimpleHotelier — Stripe's processing fee on guest card payments.
   Plain ESM (Deno + Node tests); js/money.js carries the same numbers for
   the booking page and dashboard (tests/card-fees.test.mjs keeps them equal).

   The property pays the fee, never SimpleHotelier: every guest charge carries
   an application fee equal to Stripe's fee, which is all the platform keeps.
   With the property's card_fee_mode "guest" (the default) the fee is added to
   the guest's payment, so the property still receives the full amount. Card
   network rules cap that surcharge at 3%; past the cap the property covers the
   rest. Foreign cards cost more than this estimate; daily-jobs settles the
   difference with the property once Stripe reports the actual fee. */

export const CARD_FEE = { percent: 2.9, fixedCents: 30, maxPercent: 3 };

/** Stripe's fee on a charge of `totalCents` (US card pricing). */
export function stripeFee(totalCents) {
  return Math.round(totalCents * CARD_FEE.percent / 100 + CARD_FEE.fixedCents);
}

/**
 * Split one card payment. `amount_cents` pays the booking (it is what the
 * balance goes down by); the guest's card is charged `total_cents`; the
 * platform keeps `application_fee_cents` and Stripe takes its fee from that.
 * @param {number} amountCents
 * @param {string} [mode] "guest" (the guest pays the fee) or "property"
 */
export function cardCharge(amountCents, mode = "guest") {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  let fee = 0;
  if (mode !== "property" && amount > 0) {
    // The smallest total that still nets the property `amount` after Stripe's
    // fee (never a cent over the cost), within the cap.
    let total = Math.ceil((amount + CARD_FEE.fixedCents) / (1 - CARD_FEE.percent / 100));
    while (total - 1 - stripeFee(total - 1) >= amount) total--;
    while (total - stripeFee(total) < amount) total++;
    fee = Math.max(0, Math.min(total - amount, Math.floor(amount * CARD_FEE.maxPercent / 100)));
  }
  const total = amount + fee;
  return { amount_cents: amount, fee_cents: fee, total_cents: total, application_fee_cents: Math.min(total, stripeFee(total)) };
}

/**
 * The share of a payment's card fee that goes back with a refund of
 * `refundCents` of the booking amount (card rules: surcharges are refunded
 * in proportion). `refundedCents`/`feeRefundedCents` are what earlier refunds
 * already returned, so the last refund returns exactly what is left.
 * @param {{ amount_cents: number, fee_cents?: number }} payment
 * @param {number} refundCents
 * @param {number} [refundedCents]
 * @param {number} [feeRefundedCents]
 */
export function refundFee(payment, refundCents, refundedCents = 0, feeRefundedCents = 0) {
  const fee = Math.max(0, payment.fee_cents || 0);
  if (!fee || payment.amount_cents <= 0) return 0;
  if (refundedCents + refundCents >= payment.amount_cents) return Math.max(0, fee - feeRefundedCents);
  return Math.min(fee - feeRefundedCents, Math.round(fee * refundCents / payment.amount_cents));
}
