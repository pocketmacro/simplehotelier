// SimpleHotelier — accept a team invite after account setup.
// POST { token? } with the new user's JWT. Matches a pending invite by token
// (email must equal the account email) or by account email alone, joins the
// user to that property with the invited role, and marks the invite accepted.
// The account email must be confirmed; invites expire after 14 days; an
// existing membership is never changed (no silent demotion of an owner).
// Deploy: supabase functions deploy accept-invite
// deno-lint-ignore-file no-explicit-any
import { createClient } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const INVITE_TTL_DAYS = 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in first" }, 401);
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user || !user.email) return json({ error: "Sign in first" }, 401);
    // Invites match on email, so the email must be proven before it grants access.
    if (!user.email_confirmed_at && !user.confirmed_at) return json({ error: "Confirm your email address first, then sign in again." }, 403);
    const email = user.email.toLowerCase();
    const since = new Date(Date.now() - INVITE_TTL_DAYS * 864e5).toISOString();

    const body = await req.json().catch(() => ({}));
    let invite: any = null;
    if (body.token && UUID_RE.test(String(body.token))) {
      const { data } = await admin.from("invites").select("*")
        .eq("token", String(body.token)).is("accepted_at", null).gte("created_at", since).maybeSingle();
      if (data) {
        if (String(data.email).toLowerCase() !== email) {
          return json({ error: `This invite was sent to ${data.email}. Create your account with that email to accept it.` }, 403);
        }
        invite = data;
      }
    }
    if (!invite) {
      const { data } = await admin.from("invites").select("*")
        .eq("email", email).is("accepted_at", null).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(1);
      invite = (data && data[0]) || null;
    }
    if (!invite) return json({ joined: false });

    const { error: memErr } = await admin.from("tenant_members")
      .upsert({ tenant_id: invite.tenant_id, user_id: user.id, role: invite.role }, { onConflict: "tenant_id,user_id", ignoreDuplicates: true }); // never change an existing member's role
    if (memErr) { console.error("accept-invite", memErr); return json({ error: "could not join the property" }, 500); }
    await admin.from("invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("id", invite.id);
    const { data: tenant } = await admin.from("tenants").select("id, name, slug").eq("id", invite.tenant_id).maybeSingle();
    return json({ joined: true, role: invite.role, tenant });
  } catch (e: any) {
    console.error("accept-invite", e);
    return json({ error: "accept-invite failed" }, 500);
  }
}));
