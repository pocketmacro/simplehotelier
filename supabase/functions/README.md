# Edge Functions — Stripe Connect (test mode first)

Secret keys live ONLY here, never in browser code.

## Set secrets
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   # when the webhook is added
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-provided to functions.

## Functions in this folder
| Function | What it does |
|---|---|
| `stripe-connect` | Creates/reuses a property's Connect account, returns an onboarding link. Saves `tenants.stripe_account_id`. |
| `charge-guest` | Creates a PaymentIntent on the property's account (destination charge + your app fee), records a `transactions` row. Browser calls this, then confirms with Stripe.js using the publishable key. |

## Deploy
```bash
supabase functions deploy stripe-connect
supabase functions deploy charge-guest
```

## Before real money
1. Enable Connect in the Stripe Dashboard (test mode), set platform profile + fees.
2. Add a `stripe-webhook` function for `payment_intent.succeeded/failed` and
   `account.updated` (set `tenants.stripe_onboarding_complete`).
3. Verify in test mode with card `4242 4242 4242 4242`, then repeat the
   tenant-isolation test: Property A must never charge Property B's guests.
4. Only then switch to live keys (`sk_live_...`) via `supabase secrets set`.
