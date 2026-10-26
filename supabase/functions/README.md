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
| `create-checkout` | Starts the $30/mo SimpleHotelier subscription (Stripe Checkout) for a property. Called right after signup and from Settings > Plan and billing. |
| `stripe-webhook` | Syncs subscription state to `tenants` (status, period end). Deploy with `--no-verify-jwt`. |
| `support-ai` | Spark, the in-app support assistant, powered by muse-spark via the Meta Model API. Needs `MODEL_API_KEY`; without it the app uses built-in help articles. |

## Subscription billing setup (one time, test mode)
1. Stripe Dashboard > Product catalog: create product "SimpleHotelier" with a recurring $30/month price. Copy the price ID (`price_...`).
2. `supabase secrets set STRIPE_PRICE_ID=price_...`
3. `supabase functions deploy create-checkout`
4. `supabase functions deploy stripe-webhook --no-verify-jwt`
5. Stripe Dashboard > Webhooks: endpoint `https://<project>.supabase.co/functions/v1/stripe-webhook`, events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`
6. AI support (Spark): get a key at developer.meta.com (Meta Model API), then
   `supabase secrets set MODEL_API_KEY=...` and `supabase functions deploy support-ai`.
   Optional: `supabase secrets set META_MODEL=muse-spark-1.3` (the default).

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
