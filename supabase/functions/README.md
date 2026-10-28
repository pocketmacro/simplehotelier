# Edge Functions — Stripe Connect (test mode first)

Secret keys live ONLY here, never in browser code.

## Set secrets
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...   # when the webhook is added
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-provided to functions.

The platform's name, domain, sender address and plan come from
`site.config.json` (copied into `_shared/site.js` by `node scripts/site.mjs`;
redeploy the functions after changing it).
Optional: `SITE_URL` (default: the config's domain), `EMAIL_FROM` (default:
the config's `emailFrom`) and `ALLOWED_ORIGINS` (comma-separated, e.g. a
preview host). Invite links and Stripe return URLs only ever use these, the
config's domain and its subdomains, or localhost; a caller's Origin header is
never trusted on its own.

## Functions in this folder
| Function | What it does |
|---|---|
| `stripe-connect` | Signed-in owner/admin only. Creates/reuses a property's Connect account, returns an onboarding link. Saves `tenants.stripe_account_id`. `action: "status"` (any member) syncs onboarding state. |
| `charge-guest` | Booking deposits only. Computes the deposit from the reservation total that `create_booking()` priced (never from the browser), creates the PaymentIntent on the property's account (+ app fee) and a pending `transactions` row. `action: "confirm"` re-reads it from Stripe and records it once via `record_stripe_payment()`. |
| `create-checkout` | Starts the platform subscription (Stripe Checkout, the plan in `site.config.json`) for a property. Called right after signup and from Settings > Plan and billing. |
| `stripe-webhook` | Syncs subscription state to `tenants` (status, period end). Deploy with `--no-verify-jwt`. |
| `support-ai` | Spark, the in-app support assistant, powered by muse-spark via the Meta Model API. Needs `MODEL_API_KEY`; without it the app uses built-in help articles. |

## Subscription billing setup (one time, test mode)
1. Create the product and its recurring monthly price from `site.config.json`'s plan: `node scripts/setup-platform.mjs phase1` (saves `STRIPE_PRICE_ID` to `.env`), or create them in the Stripe Dashboard and copy the price ID (`price_...`).
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

## Security hotfix rollout (20261115 migrations)
Order matters — each step keeps the live site working:
1. `node scripts/apply-sql.mjs supabase/migrations/20261115000000_security_hotfix.sql`
   (additive: role policies, billing-column guard, `create_booking`, `get_rate_plans`, `record_stripe_payment`).
2. Deploy every function that changed: `accept-invite`, `charge-guest`, `create-checkout`,
   `daily-jobs`, `ical-sync`, `send-email`, `stripe-connect`, `stripe-webhook --no-verify-jwt`, `support-ai`.
3. Deploy the site (`js/book.js` books through `create_booking`; `js/app.js` uploads to `{tenant_id}/...`).
4. `node scripts/apply-sql.mjs supabase/migrations/20261115000100_public_booking_lockdown.sql`
   (removes anonymous inserts, hides `room_types.rate_plans`, scopes storage writes).

## Before real money
1. Enable Connect in the Stripe Dashboard (test mode), set platform profile + fees.
2. Add a `stripe-webhook` function for `payment_intent.succeeded/failed` and
   `account.updated` (set `tenants.stripe_onboarding_complete`).
3. Verify in test mode with card `4242 4242 4242 4242`, then repeat the
   tenant-isolation test: Property A must never charge Property B's guests.
4. Only then switch to live keys (`sk_live_...`) via `supabase secrets set`.
