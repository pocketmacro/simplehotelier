// SimpleHotelier - browser config (auto-written by scripts/setup-supabase.ps1).
// The publishable key is safe to ship; RLS protects data. Never add service keys here.
window.SH_CONFIG = {
  SUPABASE_URL: "https://ybgmwyzizacxkfgxmroy.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_LEuT_5ZXdORDF8E9jaesOg_VYTPiG-Q",
  TENANT_SLUG: "pinecrest",
  GOOGLE_ANALYTICS_ID: "", // system-wide GA4 fallback (G-...); a property's own ID in Booking Studio wins
  TURNSTILE_SITE_KEY: "0x4AAAAAAFoRwPWRMdbHmG24", // Cloudflare Turnstile (public sitekey); the secret lives only in Supabase function secrets
  STRIPE_PUBLISHABLE_KEY: "pk_live_51UWeilBZQmk1yXCBb9ywjIIswIjOEyCvb5AIm8PlBv9YRGZtryDHMGKj6BYNlDLuY5ELGO9fC6nSRn45fcaBXFZU00oB0RGUB5" // pk_test_... / pk_live_... from Stripe > Developers > API keys. Publishable, safe to ship; needed to collect booking deposits by card.
};
