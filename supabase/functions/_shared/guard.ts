// SimpleHotelier — caller checks shared by Edge Functions.
// deno-lint-ignore-file no-explicit-any
import { safeOrigin } from "./origin.js";

/* The signed-in user behind the request's JWT, or null. */
export async function callerUser(admin: any, req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data?.user || null;
}

/* The user's role on a property ("owner" | "admin" | "staff" | "cleaner"), or null. */
export async function memberRole(admin: any, tenantId: string, userId: string): Promise<string | null> {
  if (!tenantId || !userId) return null;
  const { data } = await admin.from("tenant_members").select("role")
    .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  return data?.role || null;
}

/* Our own site origin for links (SITE_URL, ALLOWED_ORIGINS secrets). */
export function appOrigin(candidate?: string | null) {
  return safeOrigin(candidate, {
    site: Deno.env.get("SITE_URL") || "https://simplehotelier.com",
    extra: (Deno.env.get("ALLOWED_ORIGINS") || "").split(","),
  });
}
