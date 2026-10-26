# SimpleHotelier

Simple property system for cabin and boutique-hotel owners: company signup,
rooms/cabins, a custom booking page, reservations, clean/dirty housekeeping
flags, guest charges, custom add-ons, room taxes, and reports.

This repo currently contains the interactive dashboard prototype wired to a
live Supabase backend.

## Run locally
Open `index.html` in a browser (no build step). Without Supabase keys it runs
on built-in demo data; with keys it loads your live property.
Optional local server: `python -m http.server` then visit the printed URL.

## Supabase setup
See [supabase/README.md](supabase/README.md). Short version:
1. Run `supabase/migrations/20261026000000_init.sql` in the SQL Editor.
2. Optionally run `supabase/seed.sql` (Pinecrest Cabins demo).
3. Put your Project URL + publishable key in `js/config.js`
   (already done for the linked project; never put `service_role` there).
4. Or run `scripts/setup-supabase.ps1` with a `.env` (see `.env.example`)
   to apply schema/seed and write `js/config.js` automatically.
   Claim the demo tenant with `scripts/claim-tenant.ps1`.

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
