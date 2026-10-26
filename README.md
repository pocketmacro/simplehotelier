# SimpleHotelier

Simple property system for cabin and boutique-hotel owners: company signup,
rooms/cabins, a custom booking page, reservations, clean/dirty housekeeping
flags, guest charges, custom add-ons, room taxes, and reports.

This repo currently contains the interactive dashboard prototype wired to a
live Supabase backend.

## Run locally
- `index.html` is the public marketing landing page ($30/month).
- `app.html` is the dashboard (login gate, then your property).
- `book.html?property={slug}` is the guest booking page / embed widget.
Open the files in a browser (no build step). Without Supabase keys the
dashboard runs on built-in demo data; with keys it loads your live property.
Optional local server: `python -m http.server` then visit the printed URL.

## Platform: billing, support, system admin
- Subscriptions: signup (and Settings > Plan and billing) starts Stripe
  Checkout via `create-checkout`; `stripe-webhook` keeps
  `tenants.subscription_status` in sync. See `supabase/functions/README.md`.
- Support: users get the Spark assistant (muse-spark via `support-ai`,
  with built-in help articles offline) plus support cases in the app.
- System Admin view (admins only, `system_admins` table): all subscriber
  properties with billing status, and every support case with replies.
- Requires `supabase/migrations/20261028000000_admin_support.sql`
  (`scripts/apply-admin-migration.ps1` applies it and promotes your user).

## Supabase setup
See [supabase/README.md](supabase/README.md). Short version:
1. Run `supabase/migrations/20261026000000_init.sql` in the SQL Editor.
2. Optionally run `supabase/seed.sql` (Pinecrest Cabins demo).
3. Put your Project URL + publishable key in `js/config.js`
   (already done for the linked project; never put `service_role` there).
4. Or run `scripts/setup-supabase.ps1` with a `.env` (see `.env.example`)
   to apply schema/seed and write `js/config.js` automatically.
   Claim the demo tenant with `scripts/claim-tenant.ps1`.

## Public booking page + embed
- Guest page: `book.html?property={slug}` (e.g. `book.html?property=pinecrest`).
  It loads rooms/add-ons/taxes publicly, checks availability via the
  `get_available_room_ids` function (guests never see reservation data),
  computes taxes, and creates a `pending` request. The no-overlap
  constraint makes double-booking impossible.
- Embed on any website: Booking Studio shows a copy-paste iframe snippet
  (`&embed=1`) that is mobile-friendly and auto-resizes via postMessage.
- Conversion tracking (Booking Studio per property): a Google Analytics
  Measurement ID fires GA4 `purchase` + `booking_complete` on completion,
  and/or set a redirect URL — guests land there with
  `?booking_ref=&total=&currency=` appended. A system-wide GA default
  lives in `js/config.js` (`GOOGLE_ANALYTICS_ID`).
- Requires `supabase/migrations/20261027000000_booking.sql`
  (`scripts/apply-booking-migration.ps1` applies it).

## Accounts
- **Log in** with your Supabase Auth user to load your property's live data.
- **Create account** signs you up and creates your property + owner
  membership in one step (slug auto-generated from the property name).

## Stripe (test mode first)
Guest charging runs through Supabase Edge Functions with Stripe Connect —
see [supabase/functions/README.md](supabase/functions/README.md).
Secret keys live only in function secrets, never in browser code.

## Layout
- `index.html`, `css/app.css`, `js/` — static dashboard (no build)
- `supabase/` — Postgres schema (RLS + no-double-booking rule), seed, functions
- `scripts/` — one-time Supabase setup/claim helpers (read `.env`, gitignored)
- `tests/` — focused checks (run: `node --test tests/db-writes.test.mjs`)
