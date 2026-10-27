// SimpleHotelier — record an Edge Function error in Site errors (System
// Admin), next to browser errors (log_server_error, service role only).
// Message and stack only: never request bodies, tokens or card data.
// Never throws, so a logging problem can't turn into a second failure.
import { createClient } from "./deps.ts";

// deno-lint-ignore no-explicit-any
let client: any = null;

export async function logError(fn: string, err: unknown, tenantId?: string | null): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    client = client || createClient(url, key);
    const e = err as { message?: unknown; stack?: unknown } | null;
    const message = String((e && e.message) ?? err ?? "Unknown error").slice(0, 500);
    const stack = e && typeof e.stack === "string" ? e.stack.slice(0, 4000) : null;
    const tenant = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tenantId || "")) ? tenantId : null;
    await client.rpc("log_server_error", { p_function: fn, p_message: message, p_stack: stack, p_tenant: tenant });
  } catch {
    // swallow: the caller already logged to the console
  }
}
