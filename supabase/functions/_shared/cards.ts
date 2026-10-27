// SimpleHotelier — card-on-file helpers shared by charge-guest and stripe-webhook.
// Only Stripe ids and display details (brand, last4, expiry, name) are kept;
// card numbers never reach SimpleHotelier.
// deno-lint-ignore-file no-explicit-any

/* After a succeeded PaymentIntent that saved its card (setup_future_usage),
   remember that card on the reservation so the front desk can charge it. */
export async function saveCardFromIntent(stripe: any, admin: any, reservationId: string, intent: any) {
  if (!reservationId || !intent?.customer || !intent?.payment_method) return false;
  const pm = typeof intent.payment_method === "string"
    ? await stripe.paymentMethods.retrieve(intent.payment_method)
    : intent.payment_method;
  if (!pm?.card) return false;
  const { error } = await admin.from("reservations").update({
    stripe_customer_id: typeof intent.customer === "string" ? intent.customer : intent.customer.id,
    stripe_payment_method_id: pm.id,
    card_brand: pm.card.brand || null,
    card_last4: pm.card.last4 || null,
    card_exp_month: pm.card.exp_month || null,
    card_exp_year: pm.card.exp_year || null,
    cardholder_name: pm.billing_details?.name || null,
  }).eq("id", reservationId);
  return !error;
}

/* One Stripe customer per reservation, on the platform account (destination
   charges), so a saved card can never be charged for another property. */
export async function ensureCustomer(stripe: any, admin: any, resv: any, tenantId: string) {
  if (resv.stripe_customer_id) return resv.stripe_customer_id as string;
  const customer = await stripe.customers.create({
    email: resv.guest_email || undefined,
    name: resv.guest_name || undefined,
    metadata: { tenant_id: tenantId, reservation_id: resv.id },
  });
  await admin.from("reservations").update({ stripe_customer_id: customer.id }).eq("id", resv.id);
  return customer.id as string;
}
