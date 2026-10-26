# Supabase setup (5 minutes)

## 1. Apply the schema
In your Supabase project: **SQL Editor → New query**, paste
`supabase/migrations/20261026000000_init.sql`, run it.
Optionally run `supabase/seed.sql` for the Pinecrest demo tenant.

(Or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.)

## 2. Create your login
**Authentication → Users → Add user** with your email + password.
Copy that user's UUID.

## 3. Claim the demo tenant (optional)
```sql
insert into public.tenant_members (tenant_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', '<your-user-uuid>', 'owner');
```
For a real property, instead insert a `tenants` row + an owner `tenant_members` row.

## 4. Connect the frontend
Open `js/config.js` and fill in from **Project Settings → API**:
- `SUPABASE_URL` — e.g. `https://abcdefgh.supabase.co`
- `SUPABASE_ANON_KEY` — the `anon` / publishable key (safe in browsers; RLS protects data)

**Never** put the `service_role` key in frontend code.

## 5. Open the app
Open `index.html`. If config is filled in, the header data loads from Supabase
(reservations / rooms / add-ons / taxes for your first tenant). If not, the app
falls back to built-in demo data so the layout still works offline.

## How the pieces map
| Product feature | Table(s) |
|---|---|
| Company signup | `tenants` + `tenant_members` (auth.users) |
| Cabins / rooms | `rooms`, `room_types` |
| Booking page | `tenants.slug` + public read policies |
| Reservations | `reservations` (no-overlap exclusion constraint) |
| Clean / dirty | `rooms.housekeeping_status` |
| Charges / folios | `folio_entries`, `transactions` |
| Add-ons | `addons`, `reservation_addons` |
| Taxes | `tax_rules` (percent or per-night) |
| Photos | Storage buckets `room-photos`, `property-logos` |

## Stripe (next step, secrets stay server-side)
Charges must run in a Supabase Edge Function — never from the browser with a secret key.
See `supabase/functions/README.md`. You will need a Stripe test account with
Connect enabled; test keys only until launch.
