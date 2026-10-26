-- SimpleHotelier — demo seed (Pinecrest Cabins). Optional.
-- Run AFTER the init migration, in SQL Editor. Safe to re-run (on conflict do nothing).
-- Note: this tenant has no owner yet. To manage it while signed in, insert a
-- tenant_members row with your auth user id, e.g.:
--   insert into public.tenant_members (tenant_id, user_id, role)
--   values ('11111111-1111-1111-1111-111111111111', '<your-auth-user-uuid>', 'owner');

insert into public.tenants (id, name, slug, contact_email, booking_headline, booking_subheading, brand_color)
values (
  '11111111-1111-1111-1111-111111111111',
  'Pinecrest Cabins',
  'pinecrest',
  'stay@pinecrestcabins.com',
  'Cabins under the pines, minutes from the park.',
  'Eight private cabins with hot tubs, fire pits and trailhead access. Book direct and save 10%.',
  '#0c3b3c'
) on conflict (id) do nothing;

insert into public.rooms (id, tenant_id, code, name, sleeps, rate_cents, status, housekeeping_status, notes, sort_order) values
  ('21111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'A1', 'Aspen Loft',    4, 18900, 'reserved', 'dirty',    'Checkout 11 AM - arrival 3 PM', 1),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'A2', 'Birch Cabin',   6, 24900, 'occupied', 'clean',    'In-house - departs Oct 28',     2),
  ('23333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'A3', 'Cedar Suite',   2, 15900, 'occupied', 'clean',    'In-house - departs Oct 27',     3),
  ('24444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'B1', 'Dogwood Cabin', 5, 21900, 'occupied', 'progress', 'Stayover service requested',    4),
  ('25555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'B2', 'Elm Retreat',   4, 19900, 'vacant',   'clean',    'Next arrival Oct 30',           5),
  ('26666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'B3', 'Fern Hollow',   6, 25900, 'occupied', 'clean',    'In-house - departs Oct 29',     6),
  ('27777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'C1', 'Grove House',   8, 32900, 'reserved', 'dirty',    'Checkout 11 AM - arrival 4 PM', 7),
  ('28888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'C2', 'Hemlock Hideout', 2, 14900, 'vacant', 'dirty',    'Deep clean scheduled',          8)
on conflict (tenant_id, code) do nothing;

-- @@CHUNK@@
insert into public.addons (tenant_id, name, description, price_cents, per, active) values
  ('11111111-1111-1111-1111-111111111111', 'Firewood bundle',     'Large bundle + starters, stacked at the pit', 1800, 'stay',   true),
  ('11111111-1111-1111-1111-111111111111', 'Breakfast basket',    'Local eggs, bread, coffee - serves one',      3200, 'person', true),
  ('11111111-1111-1111-1111-111111111111', 'Late checkout (1 PM)','Subject to availability',                      4500, 'stay',   true),
  ('11111111-1111-1111-1111-111111111111', 'Pet fee',             'Up to 2 dogs - bowls + blanket included',     6000, 'stay',   true),
  ('11111111-1111-1111-1111-111111111111', 'Hot tub soak kit',    'Towels, salts, cedar tray',                   2500, 'stay',   true),
  ('11111111-1111-1111-1111-111111111111', 'Extra cot',           'Made up before arrival',                       2000, 'night',  false)
on conflict do nothing;

insert into public.tax_rules (tenant_id, name, kind, rate, applies_to, active, sort_order) values
  ('11111111-1111-1111-1111-111111111111', 'State lodging tax',          'percent', 6.5, 'Room + add-ons', true, 1),
  ('11111111-1111-1111-1111-111111111111', 'County tourism assessment',  'night',   2.5, 'Per night',      true, 2),
  ('11111111-1111-1111-1111-111111111111', 'Community district fee',     'percent', 1.5, 'Room only',      true, 3)
on conflict do nothing;

-- @@CHUNK@@
insert into public.reservations
  (tenant_id, room_id, guest_name, guest_email, confirmation_code, check_in, check_out, status, source, total_cents, paid_cents)
values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'Daniel Okafor',   'd.okafor@mail.com', 'R-1042', '2026-10-24', '2026-10-28', 'checked_in', 'direct', 87240, 38620),
  ('11111111-1111-1111-1111-111111111111', '23333333-3333-3333-3333-333333333333', 'Priya Nair',      null,                'R-1043', '2026-10-25', '2026-10-27', 'checked_in', 'direct', 40210, 40210),
  ('11111111-1111-1111-1111-111111111111', '21111111-1111-1111-1111-111111111111', 'Tom Becker',      'tom.b@mail.com',    'R-1046', '2026-10-26', '2026-10-29', 'confirmed',  'direct', 64075, 20000),
  ('11111111-1111-1111-1111-111111111111', '27777777-7777-7777-7777-777777777777', 'Aisha Khan',      null,                'R-1047', '2026-10-26', '2026-10-28', 'confirmed',  'phone',  71590, 0),
  ('11111111-1111-1111-1111-111111111111', '25555555-5555-5555-5555-555555555555', 'Greg Poulsen',    'greg.p@mail.com',   'R-1048', '2026-10-30', '2026-11-02', 'pending',    'direct', 65520, 0)
on conflict (tenant_id, confirmation_code) do nothing;
