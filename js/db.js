/* SimpleHotelier — Supabase data layer (REST, no build step).
   If js/config.js is empty, everything no-ops and the app keeps demo data.
   Only the anon key is used in the browser. Signed-in reads send the user's
   access token from localStorage ("sh_access_token") once login is added. */
"use strict";

(function () {
  const cfg = window.SH_CONFIG || {};
  const ANCHOR = new Date(2026, 9, 26); // prototype "today" (matches demo data)
  const DAY = 864e5;
  const configured = () => !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  function token() {
    try { return localStorage.getItem("sh_access_token") || cfg.SUPABASE_ANON_KEY; }
    catch { return cfg.SUPABASE_ANON_KEY; }
  }

  async function rest(path, opts = {}) {
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, {
      ...opts,
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + token(),
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });
    if (!res.ok) throw new Error("Supabase " + res.status + " on " + path);
    return res.status === 204 ? null : res.json();
  }

  const dayOff = (iso) => Math.round((new Date(iso + "T12:00:00") - ANCHOR) / DAY);
  const mapStatus = (s) => ({ checked_in: "checked-in", checked_out: "checked-out" }[s] || s);

  /* Signed-in path: resolve the user's tenant via tenant_members (RLS-safe). */
  async function memberTenant() {
    const t = token();
    if (!t || t === cfg.SUPABASE_ANON_KEY) return null;
    try {
      const ures = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + t }
      });
      if (!ures.ok) return null;
      const user = await ures.json();
      const mem = await rest("tenant_members?user_id=eq." + user.id + "&select=tenant_id&limit=1");
      if (!mem || !mem.length) return { user, tenant: null };
      const tenants = await rest("tenants?id=eq." + mem[0].tenant_id + "&select=*");
      return { user, tenant: (tenants && tenants[0]) || null };
    } catch { return null; }
  }

  async function loadLiveData() {
    if (!configured()) return null;
    try {
      const mt = await memberTenant();
      let tenant = null, user = null;
      if (mt) {
        user = mt.user;
        tenant = mt.tenant;
        if (!tenant) return { tenant: null, user, rooms: [], reservations: [], addons: [], taxes: [] };
      }
      if (!tenant) {
        const tenants = await rest("tenants?slug=eq." + encodeURIComponent(cfg.TENANT_SLUG || "pinecrest") + "&select=*");
        tenant = tenants && tenants[0];
        if (!tenant) return null;
      }
      const tid = "tenant_id=eq." + tenant.id;
      const [rooms, reservations, addons, taxes] = await Promise.all([
        rest("rooms?" + tid + "&select=*&order=sort_order.asc"),
        rest("reservations?" + tid + "&select=*&order=check_in.asc"),
        rest("addons?" + tid + "&select=*&order=name.asc"),
        rest("tax_rules?" + tid + "&select=*&order=sort_order.asc")
      ]);
      const roomCode = (id) => (rooms.find((r) => r.id === id) || {}).code || "—";
      return {
        tenant, user,
        rooms: rooms.map((r) => ({
          id: r.id, code: r.code, name: r.name,
          type: (r.sleeps ? "Sleeps " + r.sleeps : "Unit"),
          rate: (r.rate_cents || 0) / 100, status: r.status,
          hk: r.housekeeping_status, guest: "", note: r.notes || ""
        })),
        reservations: reservations.map((r) => ({
          id: r.id, ref: r.confirmation_code, guest: r.guest_name,
          contact: r.guest_email || r.guest_phone || "—",
          room: roomCode(r.room_id), inN: dayOff(r.check_in), outN: dayOff(r.check_out),
          status: mapStatus(r.status), total: (r.total_cents || 0) / 100, paid: (r.paid_cents || 0) / 100
        })),
        addons: addons.map((a) => ({ id: a.id, name: a.name, price: (a.price_cents || 0) / 100, per: a.per, on: a.active, desc: a.description || "" })),
        taxes: taxes.map((t) => ({ id: t.id, name: t.name, kind: t.kind, value: Number(t.rate), applies: t.applies_to, on: t.active }))
      };
    } catch (err) {
      console.warn("[SimpleHotelier] Live load failed, using demo data:", err.message);
      return null;
    }
  }

  // Best-effort housekeeping sync (requires a signed-in member; RLS decides).
  async function updateHK(room) {
    if (!configured() || !room.id) return;
    try {
      await rest("rooms?id=eq." + room.id, {
        method: "PATCH",
        body: JSON.stringify({ housekeeping_status: room.hk })
      });
    } catch { /* offline / anon: local change still stands */ }
  }

  window.SHDB = { configured, loadLiveData, updateHK };
})();
