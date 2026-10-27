// SimpleHotelier — team invites.
// POST { action: "peek", token }      (no sign-in) -> who the invite is for,
//   whether that email already has an account (log in instead of signing up)
//   and whether it is already on the team
// POST { action: "signup", token, password }  (no sign-in) -> creates the
//   invited person's account already confirmed (the emailed link proves the
//   inbox), joins them to the property and marks the invite accepted; the
//   page then signs in with the password. An existing confirmed account is
//   told to log in instead; an unconfirmed one is confirmed with this password.
// POST { token? } with a user's JWT -> accept after signing in: the invite in
//   the link (its email must equal the account email), or else every pending
//   invite for the account email. The account email must be confirmed. One
//   login can belong to several properties; the response names each one joined.
// Invites expire after 14 days; an existing membership is never changed
// (no silent demotion of an owner).
// Deploy: supabase functions deploy accept-invite
// deno-lint-ignore-file no-explicit-any
import { createClient } from "../_shared/deps.ts";
import { withCors } from "../_shared/cors.ts";
import { logError } from "../_shared/errors.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const INVITE_TTL_DAYS = 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", staff: "Front desk", cleaner: "Housekeeping", maintenance: "Maintenance" };

async function pendingInvite(token: unknown) {
  if (!token || !UUID_RE.test(String(token))) return null;
  const since = new Date(Date.now() - INVITE_TTL_DAYS * 864e5).toISOString();
  const { data } = await admin.from("invites").select("*")
    .eq("token", String(token)).is("accepted_at", null).gte("created_at", since).maybeSingle();
  return data || null;
}
async function join(invite: any, userId: string) {
  const { error } = await admin.from("tenant_members")
    .upsert({ tenant_id: invite.tenant_id, user_id: userId, role: invite.role }, { onConflict: "tenant_id,user_id", ignoreDuplicates: true }); // never change an existing member's role
  if (error) throw error;
  await admin.from("invites").update({ accepted_at: new Date().toISOString(), accepted_by: userId }).eq("id", invite.id);
  const { data: tenant } = await admin.from("tenants").select("id, name, slug").eq("id", invite.tenant_id).maybeSingle();
  return tenant ? { ...tenant, role: invite.role } : null;
}

/* Invite link -> account, no second email check (see the header). */
async function inviteSignup(body: any) {
  const invite = await pendingInvite(body.token);
  if (!invite) return json({ error: "invite_invalid", message: "This invite link has expired or was already used. Ask for a new one." }, 404);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8 || password.length > 72) return json({ error: "weak_password", message: "Use a password of at least 8 characters." }, 400);
  const email = String(invite.email).toLowerCase();
  const { data: found } = await admin.rpc("auth_user_by_email", { p_email: email });
  const existing = Array.isArray(found) ? found[0] : null;
  let userId: string;
  if (existing && existing.confirmed) {
    return json({ error: "account_exists", email, message: "You already have an account with this email. Log in and this property is added to it." }, 409);
  } else if (existing) {
    // Signed up before but never confirmed: the invite link proves the inbox.
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    if (error) throw error;
    userId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error || new Error("createUser returned no user");
    userId = data.user.id;
  }
  const tenant = await join(invite, userId);
  return json({ joined: true, email, role: invite.role, tenant });
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "peek") {
      const invite = await pendingInvite(body.token);
      if (!invite) return json({ valid: false });
      const { data: tenant } = await admin.from("tenants").select("name").eq("id", invite.tenant_id).maybeSingle();
      const { data: found } = await admin.rpc("auth_user_by_email", { p_email: String(invite.email).toLowerCase() });
      const acct = Array.isArray(found) ? found[0] : null;
      let member = false;
      if (acct) {
        const { data: m } = await admin.from("tenant_members").select("user_id")
          .eq("tenant_id", invite.tenant_id).eq("user_id", acct.id).maybeSingle();
        member = !!m;
      }
      return json({
        valid: true, email: invite.email, property: tenant?.name || "the property", role: ROLE_LABELS[invite.role] || invite.role,
        account: !!(acct && acct.confirmed), member,
      });
    }
    if (body.action === "signup") return await inviteSignup(body);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign in first" }, 401);
    const { data: userData } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (!user || !user.email) return json({ error: "Sign in first" }, 401);
    // Invites match on email, so the email must be proven before it grants access.
    if (!user.email_confirmed_at && !user.confirmed_at) return json({ error: "Confirm your email address first, then sign in again." }, 403);
    const email = user.email.toLowerCase();
    const since = new Date(Date.now() - INVITE_TTL_DAYS * 864e5).toISOString();

    let invites: any[] = [];
    const byToken = await pendingInvite(body.token);
    if (byToken) {
      if (String(byToken.email).toLowerCase() !== email) {
        return json({ error: `This invite was sent to ${byToken.email}. Sign out and log in (or sign up) with that email to accept it.` }, 403);
      }
      invites = [byToken];
    } else {
      // Invite emails are stored lowercased (send-email teamInvite).
      const { data } = await admin.from("invites").select("*")
        .eq("email", email).is("accepted_at", null).gte("created_at", since)
        .order("created_at", { ascending: false }).limit(20);
      invites = data || [];
    }
    if (!invites.length) return json({ joined: false });

    const tenants = [];
    for (const invite of invites) {
      const tenant = await join(invite, user.id);
      if (tenant) tenants.push(tenant);
    }
    if (!tenants.length) return json({ joined: false });
    // tenant/role: the invite in the link, or the newest one.
    return json({ joined: true, role: tenants[0].role, tenant: tenants[0], tenants });
  } catch (e: any) {
    console.error("accept-invite", e); await logError("accept-invite", e);
    return json({ error: "accept-invite failed" }, 500);
  }
}));
