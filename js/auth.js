/* SimpleHotelier — Supabase Auth (login, signup + property onboarding, session).
   Uses the Auth REST API directly; tokens live in localStorage
   (sh_access_token is also read by js/db.js for RLS-protected reads). */
"use strict";

(function () {
  const cfg = window.SH_CONFIG || {};
  const base = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
  const anon = cfg.SUPABASE_ANON_KEY || "";
  const configured = () => !!(base && anon);

  const $ = (s) => document.querySelector(s);
  const gate = () => $("#authGate");

  function saveSession(data) {
    if (!data) return;
    const user = data.user || (data.session && data.session.user);
    if (data.access_token) localStorage.setItem("sh_access_token", data.access_token);
    if (data.session && data.session.access_token) localStorage.setItem("sh_access_token", data.session.access_token);
    if (data.refresh_token) localStorage.setItem("sh_refresh_token", data.refresh_token);
    if (data.session && data.session.refresh_token) localStorage.setItem("sh_refresh_token", data.session.refresh_token);
    if (user) localStorage.setItem("sh_user", JSON.stringify({ id: user.id, email: user.email || "" }));
  }
  function sessionUser() {
    try { return JSON.parse(localStorage.getItem("sh_user") || "null"); } catch { return null; }
  }

  /* Team invites: app.html?invite=TOKEN. Captured immediately (the link may be
     opened before account setup); the claim itself happens in js/app.js once
     the new user is signed in. Invitees skip property creation and billing. */
  try {
    const inv = new URLSearchParams(location.search).get("invite");
    if (inv) localStorage.setItem("sh_invite_token", inv);
  } catch { /* no storage */ }
  const invitePending = () => { try { return !!localStorage.getItem("sh_invite_token"); } catch { return false; } };
  const inviteToken = () => { try { return localStorage.getItem("sh_invite_token") || ""; } catch { return ""; } };
  const forgetInvite = () => { try { localStorage.removeItem("sh_invite_token"); } catch { /* no storage */ } };
  /* accept-invite before sign-in: "peek" (who it's for) and "signup" (the
     emailed link proves the inbox, so the account is created confirmed). */
  async function inviteCall(body) {
    const res = await fetch(base + "/functions/v1/accept-invite", {
      method: "POST",
      headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json" },
      body: JSON.stringify({ token: inviteToken(), ...body })
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }
  let invite = null; // { email, property, role, account, member } once peeked
  /* The green note above the forms: plain text plus the property name in bold. */
  function inviteNote(before, property, after) {
    const banner = $("#inviteBanner");
    if (!banner) return;
    banner.hidden = false;
    banner.textContent = "";
    banner.append(before, Object.assign(document.createElement("strong"), { textContent: property }), after);
  }
  /* The invited email already has an account: log in to accept. app.js claims
     the invite once they're signed in and opens that property. */
  function inviteLogin(email) {
    setTab("login");
    $("#liEmail").value = email || "";
    $("#liPassword").focus();
  }
  function accessToken() { return localStorage.getItem("sh_access_token") || ""; }

  /* Exchange the stored refresh token for a fresh session (tokens expire hourly). */
  async function refreshSession() {
    if (window.SHDB && SHDB.freshToken) {
      const before = accessToken();
      const t = await SHDB.freshToken();
      if (t && t !== before) return sessionUser();
    }
    const refresh = localStorage.getItem("sh_refresh_token");
    if (!refresh || !configured()) return null;
    try {
      const data = await authFetch("token?grant_type=refresh_token", {
        method: "POST", body: JSON.stringify({ refresh_token: refresh })
      });
      saveSession(data);
      return sessionUser();
    } catch { return null; }
  }
  async function freshAccessToken() {
    if (window.SHDB && SHDB.freshToken) return SHDB.freshToken();
    await refreshSession();
    return accessToken();
  }
  function clearSession() {
    localStorage.removeItem("sh_access_token");
    localStorage.removeItem("sh_refresh_token");
    localStorage.removeItem("sh_user");
  }

  async function authFetch(path, opts = {}, withUserToken) {
    const headers = { apikey: anon, "Content-Type": "application/json", ...(opts.headers || {}) };
    if (withUserToken && accessToken()) headers.Authorization = "Bearer " + accessToken();
    else if (!headers.Authorization) headers.Authorization = "Bearer " + anon;
    const res = await fetch(base + "/auth/v1/" + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.message || data.error_description || ("Auth " + res.status));
    return data;
  }

  async function login(email, password) {
    const data = await authFetch("token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email, password })
    });
    saveSession(data);
    return sessionUser();
  }

  async function signup(email, password) {
    // Send confirmation links back to this app (not the Site URL landing page,
    // and never localhost). Must be covered by the auth redirect allowlist.
    let redirect = "";
    try {
      if (location.protocol.startsWith("http")) redirect = "?redirect_to=" + encodeURIComponent(location.origin + location.pathname);
    } catch { /* file:// or tests: default Site URL applies */ }
    const data = await authFetch("signup" + redirect, {
      method: "POST", body: JSON.stringify({ email, password })
    });
    saveSession(data);
    return data;
  }

  async function logout() {
    try { await authFetch("logout", { method: "POST" }, true); } catch { /* token may be dead */ }
    clearSession();
  }

  async function validateSession() {
    if (!configured() || !accessToken()) return null;
    try {
      const user = await authFetch("user", {}, true);
      localStorage.setItem("sh_user", JSON.stringify({ id: user.id, email: user.email || "" }));
      return user;
    } catch {
      // Token may just be expired: refresh and retry before giving up.
      const refreshed = await refreshSession();
      if (refreshed) {
        try {
          const user = await authFetch("user", {}, true);
          localStorage.setItem("sh_user", JSON.stringify({ id: user.id, email: user.email || "" }));
          return user;
        } catch { /* fall through to clearing */ }
      }
      clearSession();
      return null;
    }
  }

  function slugify(name) {
    return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-property";
  }

  async function restInsert(path, body) {
    const res = await fetch(base + "/rest/v1/" + path, {
      method: "POST",
      headers: {
        apikey: anon, Authorization: "Bearer " + (await freshAccessToken()),
        "Content-Type": "application/json", Prefer: "return=representation"
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) throw new Error((data && (data.message || data.details)) || ("Save failed (" + res.status + ")"));
    return data;
  }

  /* Starts Stripe Checkout for the $30/mo subscription when billing is deployed. */
  async function tryBilling(tenant) {
    try {
      const res = await fetch(base + "/functions/v1/create-checkout", {
        method: "POST",
        headers: { apikey: anon, Authorization: "Bearer " + (await freshAccessToken()), "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenant.id, origin: location.origin })
      });
      if (!res.ok) return false;
      const d = await res.json().catch(() => ({}));
      if (d.url) { location.href = d.url; return true; }
    } catch { /* billing not deployed yet: continue into the app */ }
    return false;
  }

  /* Creates the tenant + owner membership for the signed-in user. */
  async function createProperty(name) {
    const user = sessionUser();
    if (!user) throw new Error("Please log in first.");
    const slugBase = slugify(name);
    let tenant = null;
    for (let i = 0; i < 4 && !tenant; i++) {
      const slug = i === 0 ? slugBase : slugBase + "-" + Math.random().toString(36).slice(2, 6);
      try {
        // Name the columns: browsers can't read every tenants column (ical_token, billing ids).
        const rows = await restInsert("tenants?select=id,name,slug,created_by,contact_email", { name, slug, created_by: user.id, contact_email: user.email });
        tenant = rows[0];
      } catch (e) {
        if (!/duplicate|unique|23505/i.test(e.message)) throw e;
      }
    }
    if (!tenant) throw new Error("Could not create the property. Try a different name.");
    await restInsert("tenant_members", { tenant_id: tenant.id, user_id: user.id, role: "owner" });
    return tenant;
  }

  function showError(msg) {
    const el = $("#authError");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function setTab(which) {
    $("#tabLogin").classList.toggle("active", which === "login");
    $("#tabSignup").classList.toggle("active", which === "signup");
    $("#loginForm").hidden = which !== "login";
    $("#signupForm").hidden = which !== "signup";
    showError("");
  }
  /* Demo is an explicit, local-only opt-in. It sets a session flag and
     reloads so the dashboard boots straight into sample data without ever
     querying a real property (see demoMode() in js/app.js). */
  const demoChosen = () => { try { return sessionStorage.getItem("sh_demo") === "1"; } catch { return false; } };
  const clearDemo = () => { try { sessionStorage.removeItem("sh_demo"); } catch { /* no storage */ } };

  function enterApp(user) {
    clearDemo();
    if (gate()) gate().hidden = true;
    const out = $("#signOutBtn"); if (out) out.hidden = false;
    window.dispatchEvent(new CustomEvent("sh-auth", { detail: { user } }));
  }

  function wire() {
    if (!$("#authGate") || !configured()) return;
    $("#tabLogin").addEventListener("click", () => setTab("login"));
    $("#tabSignup").addEventListener("click", () => setTab("signup"));
    $("#toSignup").addEventListener("click", () => setTab("signup"));
    $("#toLogin").addEventListener("click", () => setTab("login"));
    if (location.hash === "#signup") setTab("signup");
    if (location.hash === "#login") setTab("login");
    if (invitePending()) {
      // Invited teammate: different account setup — free account only.
      const banner = $("#inviteBanner"); if (banner) banner.hidden = false;
      const propField = $("#suProperty") && $("#suProperty").closest(".field");
      if (propField) propField.hidden = true;
      if ($("#suProperty")) $("#suProperty").removeAttribute("required");
      const submit = $("#suSubmit"); if (submit) submit.textContent = "Set password & join";
      $("#suPassword").minLength = 8;
      $("#suPassword").placeholder = "8+ characters";
      const help = $("#suPassword").parentElement.querySelector(".help");
      if (help) help.textContent = "You'll go straight in: the invite email already confirmed your address.";
      setTab("signup");
      inviteCall({ action: "peek" }).then(({ data }) => {
        if (!data.valid) {
          forgetInvite();
          if (banner) banner.textContent = "This invite link has expired or was already used. Ask the property for a new invite, or log in if you already joined.";
          setTab("login");
          return;
        }
        invite = data;
        $("#suEmail").value = data.email;
        $("#suEmail").readOnly = true;
        if (data.member) {
          inviteNote("You're already on the team at ", data.property, ". Log in to open it.");
          inviteLogin(data.email);
        } else if (data.account) {
          inviteNote("You're joining ", data.property, ` as ${data.role}. You already have a SimpleHotelier account with this email, so log in to accept.`);
          inviteLogin(data.email);
        } else {
          inviteNote("You're joining ", data.property, ` as ${data.role}. Set a password to finish.`);
        }
      }).catch(() => { /* keep the generic banner */ });
    }
    $("#demoBtn").addEventListener("click", () => {
      try { sessionStorage.setItem("sh_demo", "1"); } catch { /* no storage */ }
      location.reload();
    });
    $("#signOutBtn").addEventListener("click", async () => { clearDemo(); await logout(); location.reload(); });

    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault(); showError("");
      const btn = $("#liSubmit"); btn.disabled = true; btn.textContent = "Logging in…";
      try {
        const user = await login($("#liEmail").value.trim(), $("#liPassword").value);
        enterApp(user);
      } catch (err) { showError(err.message); }
      btn.disabled = false; btn.textContent = "Log in";
    });

    $("#signupForm").addEventListener("submit", async (e) => {
      e.preventDefault(); showError("");
      const btn = $("#suSubmit"); btn.disabled = true; btn.textContent = "Creating…";
      const invited = invitePending();
      if (!invited && !$("#suProperty").value.trim()) { showError("Give your property a name — it becomes your booking page title."); $("#suProperty").focus(); btn.disabled = false; btn.textContent = "Create property & log in"; return; }
      if (invited) {
        // The invite link proves the inbox: create the account confirmed, join, sign in.
        try {
          const password = $("#suPassword").value;
          const { ok, data } = await inviteCall({ action: "signup", password });
          if (data.error === "account_exists") {
            // Not an error: they already use SimpleHotelier. Log in to accept.
            inviteNote("You already have an account with this email. Log in to join ", (invite && invite.property) || "the property", ".");
            inviteLogin(data.email);
          } else if (!ok) {
            showError(data.message || "We couldn't finish joining. Please try again.");
          } else {
            const user = await login(data.email, password);
            forgetInvite();
            enterApp(user);
            return;
          }
        } catch (err) { showError(err.message); }
        btn.disabled = false; btn.textContent = "Set password & join";
        return;
      }
      try {
        const data = await signup($("#suEmail").value.trim(), $("#suPassword").value);
        if (!accessToken()) {
          showError("Account created. Please check your email to confirm, then log in.");
          setTab("login");
          return;
        }
        const tenant = await createProperty($("#suProperty").value.trim());
        const billed = await tryBilling(tenant);
        if (!billed) enterApp(sessionUser());
      } catch (err) { showError(err.message); }
      btn.disabled = false; btn.textContent = "Create property & log in";
    });

    // Demo was explicitly chosen: skip the gate (app.js renders sample data).
    if (demoChosen() && !accessToken()) { gate().hidden = true; return; }

    // Returning session? Validate in the background; otherwise show the gate.
    if (accessToken()) {
      validateSession().then((user) => {
        if (user) enterApp(sessionUser());
        else if (gate()) gate().hidden = false;
      });
    } else {
      gate().hidden = false;
    }
  }

  window.SHAuth = { configured, sessionUser, logout, validateSession, wire, createProperty };
  wire();
})();
