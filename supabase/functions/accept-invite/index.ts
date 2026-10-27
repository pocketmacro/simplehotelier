// SimpleHotelier — accept a team invite after account setup.
// POST { token? } with the new user's JWT. Matches a pending invite by token
// (email must equal the account email) or by account email alone, joins the
// user to that property with the invited role, and marks the invite accepted.
// Deploy: supabase functions deploy accept-invite
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in first" }, 401);
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user || !user.email) return json({ error: "Sign in first" }, 401);
    const email = user.email.toLowerCase();

    const body = await req.json().catch(() => ({}));
    let invite: any = null;
    if (body.token) {
      const { data } = await admin.from("invites").select("*")
        .eq("token", String(body.token)).is("accepted_at", null).maybeSingle();
      if (data) {
        if (String(data.email).toLowerCase() !== email) {
          return json({ error: `This invite was sent to ${data.email}. Create your account with that email to accept it.` }, 403);
        }
        invite = data;
      }
    }
    if (!invite) {
      const { data } = await admin.from("invites").select("*")
        .eq("email", email).is("accepted_at", null)
        .order("created_at", { ascending: false }).limit(1);
      invite = (data && data[0]) || null;
    }
    if (!invite) return json({ joined: false });

    const { error: memErr } = await admin.from("tenant_members")
      .upsert({ tenant_id: invite.tenant_id, user_id: user.id, role: invite.role }, { onConflict: "tenant_id,user_id" });
    if (memErr) return json({ error: memErr.message }, 500);
    await admin.from("invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("id", invite.id);
    const { data: tenant } = await admin.from("tenants").select("id, name, slug").eq("id", invite.tenant_id).maybeSingle();
    return json({ joined: true, role: invite.role, tenant });
  } catch (e: any) {
    return json({ error: e.message ?? "accept-invite failed" }, 500);
  }
});
