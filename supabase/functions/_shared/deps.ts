// SimpleHotelier — third-party modules for every Edge Function, pinned to
// exact versions so a new release can never change payment or data code
// without a deliberate bump here (then redeploy all functions).
export { default as Stripe } from "https://esm.sh/stripe@14.25.0?target=deno";
export { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
