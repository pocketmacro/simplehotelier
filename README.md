# SimpleHotelier

Simple property system for cabin and boutique-hotel owners: company signup,
rooms/cabins, a custom booking page, reservations, clean/dirty housekeeping
flags, guest charges, custom add-ons, room taxes, and reports.

This repo currently contains the interactive dashboard prototype wired to a
live Supabase backend.

## Run your own copy (your name, domain and price)
Everything that says who runs the platform lives in `site.config.json`:

| Key | What it is |
|---|---|
| `name` | Platform name: page titles, dashboard, emails, legal pages, "Powered by" on booking pages |
| `domain` | Your site's host, e.g. `stays.example` (the site is served at `https://{domain}`) |
| `bookingSubdomains` | `true` if `*.{domain}` points at the site, so each property gets `{slug}.{domain}`; `false` uses `book.html?property={slug}` |
| `extraOrigins` | Other https origins that serve the site (e.g. a `workers.dev` preview) |
| `supportEmail` | Shown on the Terms and Privacy pages |
| `emailFrom` | Sender for every email (verify this domain with your mail provider) |
| `plan` | `priceCents`, `currency` and `trialDays` of the monthly subscription |
| `logoMark`, `favicon` | Logo files (replace the SVGs in `assets/`, or point at your own) |
| `sourceUrl` | Link to your copy's source code, shown in every footer (the AGPL requires offering it to your users) |
| `operator` | Optional: the business running your copy. The site footer then says "{name} is owned and operated by {operator}", and the Terms and Privacy pages name it as "we" (the party customers deal with). Empty: no footer line, and "we" is `name` |

Then run `node scripts/site.mjs`. It rewrites `js/site.js` (the browser's
copy), `supabase/functions/_shared/site.js` (the functions' copy) and the
static pages, which carry the name, domain, price and trial without needing
JavaScript. Run it again after every change: `js/site.js` records the values
last applied, so it knows what to replace. `node scripts/site.mjs --check`
(and `tests/site-config.test.mjs`) fail if anything is out of date.
Use a distinctive name and domain: the static pages are updated by replacing
the old values. It also points the `_headers` CSP at the Supabase project in
`js/config.js`.

Also yours to change:
- The wording of `index.html` (marketing), `terms.html` and `privacy.html`
  (have your own legal terms reviewed; the name, domain, email, price and
  trial update automatically).
- Colors: `css/tokens.css` (site) and the email shells in
  `supabase/functions/_shared/email.ts` and `scripts/set-auth-emails.mjs`.
- After `site.config.json`: `node scripts/setup-platform.mjs phase1` creates
  the Stripe product and price for your plan (after a later price change,
  `node scripts/setup-platform.mjs price` makes the new price and points
  checkout at it); `node scripts/set-auth-emails.mjs` brands the sign-in
  emails; redeploy the Edge Functions. Existing subscriptions keep their old
  price until you move them in Stripe (give owners notice first).

## Run locally
- `index.html` is the public marketing landing page.
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

## Managing your property
- **Room Types** (Rooms & Cabins > Room types): create, edit and delete
  types, then assign them when adding or editing rooms.
- **Rates**: open Rate Calendar to click any date and set an override, or
  bulk-set a whole season or weekends only. Days without an override always
  use the room's default rate, in the dashboard and on the booking page.
- **Branding and photos**: Settings > Property logo uploads your logo to
  Supabase Storage (shown on the booking page). Each room card has Photos
  for gallery uploads; the first photo becomes the booking page cover.
- Requires `supabase/migrations/20261029000000_rates_photos.sql`
  (`node scripts/apply-sql.mjs supabase/migrations/20261029000000_rates_photos.sql`).
- Brand assets: `assets/logo.svg`, `assets/logo-mark.svg`, `assets/favicon.svg`
  (the paths and name are set in `site.config.json`).

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

## License
Copyright (C) 2026 Sam Williams.

SimpleHotelier is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License, version 3, as
published by the Free Software Foundation. See [LICENSE](LICENSE).

In short: you may run, change and rebrand it (see "Run your own copy"). If
you run a modified version as a service for other people, the AGPL requires
you to offer those users the source code of your version under the same
license: set `sourceUrl` in `site.config.json` to your repository and every
page footer (landing, legal, booking page, sign-in, dashboard) links to it. Properties that use a hosted copy, or embed its booking page on
their website, take on no obligations.
