// SimpleHotelier - browser config (auto-written by scripts/setup-supabase.ps1).
// The publishable key is safe to ship; RLS protects data. Never add service keys here.
window.SH_CONFIG = {
  SUPABASE_URL: "https://ybgmwyzizacxkfgxmroy.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_LEuT_5ZXdORDF8E9jaesOg_VYTPiG-Q",
  TENANT_SLUG: "pinecrest",
  GOOGLE_ANALYTICS_ID: "", // system-wide GA4 fallback (G-...); a property's own ID in Booking Studio wins
  STRIPE_PUBLISHABLE_KEY: "pk_test_51UUsNbCXgGEQW3VqlqLOGCaFAEyUXzWIAp14tvc74smNIwl2OfwB1rKiDRXBjqS8cM8wMufwCSsb8zI1NUrid9ut00s6wVt0Oj" // pk_test_... / pk_live_... from Stripe > Developers > API keys. Publishable, safe to ship; needed to collect booking deposits by card.
};
