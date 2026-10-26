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
  const statusIn = (s) => ({ "checked-in": "checked_in", "checked-out": "checked_out" }[s] || s);
  const ctx = { tenantId: null, roomIdByCode: {} }; // set by loadLiveData; writes no-op without it

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
      ctx.tenantId = tenant.id;
      const [rooms, reservations, addons, taxes] = await Promise.all([
        rest("rooms?" + tid + "&select=*&order=sort_order.asc"),
        rest("reservations?" + tid + "&select=*&order=check_in.asc"),
        rest("addons?" + tid + "&select=*&order=name.asc"),
        rest("tax_rules?" + tid + "&select=*&order=sort_order.asc")
      ]);
      ctx.roomIdByCode = {};
      rooms.forEach((r) => { ctx.roomIdByCode[r.code] = r.id; });
      const txnRows = await rest("transactions?" + tid + "&select=*&order=created_at.desc&limit=20").catch(() => []);
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
        taxes: taxes.map((t) => ({ id: t.id, name: t.name, kind: t.kind, value: Number(t.rate), applies: t.applies_to, on: t.active })),
        txns: (txnRows || []).map((t) => ({
          when: new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          desc: t.description, method: t.method || "Card", status: t.status, amount: (t.amount_cents || 0) / 100
        }))
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

  /* ---------------- Writes (member-only under RLS; no-op in demo mode) ---------------- */
  const rep = { Prefer: "return=representation" };
  async function createReservation(p) {
    if (!ctx.tenantId) return null;
    const isEmail = p.contact && p.contact.includes("@");
    const rows = await rest("reservations", {
      method: "POST", headers: rep,
      body: JSON.stringify({
        tenant_id: ctx.tenantId, room_id: ctx.roomIdByCode[p.roomCode] || null,
        guest_name: p.guestName, guest_email: isEmail ? p.contact : null,
        guest_phone: isEmail ? null : (p.contact || null),
        confirmation_code: p.ref, check_in: p.checkIn, check_out: p.checkOut,
        status: statusIn(p.status || "confirmed"), source: p.source || "direct",
        notes: p.notes || null, subtotal_cents: p.subtotalCents | 0,
        tax_cents: p.taxCents | 0, total_cents: p.totalCents | 0, paid_cents: p.paidCents | 0
      })
    });
    return rows && rows[0];
  }
  async function setReservationStatus(id, status) {
    if (!id) return;
    await rest("reservations?id=eq." + id, { method: "PATCH", body: JSON.stringify({ status: statusIn(status) }) });
  }
  async function updateReservationPaid(id, paidCents) {
    if (!id) return;
    await rest("reservations?id=eq." + id, { method: "PATCH", body: JSON.stringify({ paid_cents: paidCents | 0 }) });
  }
  async function addTransaction(t) {
    if (!ctx.tenantId) return null;
    const rows = await rest("transactions", {
      method: "POST", headers: rep,
      body: JSON.stringify({
        tenant_id: ctx.tenantId, reservation_id: t.reservationId || null,
        description: t.description, method: t.method || "Card",
        status: t.status || "paid", amount_cents: Math.round((t.amountCents || 0))
      })
    });
    return rows && rows[0];
  }
  async function createAddon(a) {
    if (!ctx.tenantId) return null;
    const rows = await rest("addons", {
      method: "POST", headers: rep,
      body: JSON.stringify({ tenant_id: ctx.tenantId, name: a.name, description: a.desc || null, price_cents: Math.round((a.price || 0) * 100), per: a.per || "stay", active: true })
    });
    return rows && rows[0];
  }
  async function setAddonActive(id, on) {
    if (!id) return;
    await rest("addons?id=eq." + id, { method: "PATCH", body: JSON.stringify({ active: !!on }) });
  }
  async function deleteAddon(id) { if (id) await rest("addons?id=eq." + id, { method: "DELETE" }); }
  async function createTax(t) {
    if (!ctx.tenantId) return null;
    const rows = await rest("tax_rules", {
      method: "POST", headers: rep,
      body: JSON.stringify({ tenant_id: ctx.tenantId, name: t.name, kind: t.kind, rate: t.value, applies_to: t.applies || "Room + add-ons", active: true })
    });
    return rows && rows[0];
  }
  async function deleteTax(id) { if (id) await rest("tax_rules?id=eq." + id, { method: "DELETE" }); }
  async function createRoom(r) {
    if (!ctx.tenantId) return null;
    const rows = await rest("rooms", {
      method: "POST", headers: rep,
      body: JSON.stringify({ tenant_id: ctx.tenantId, code: r.code, name: r.name, sleeps: r.sleeps || 2, rate_cents: Math.round((r.rate || 0) * 100), status: "vacant", housekeeping_status: "clean" })
    });
    return rows && rows[0];
  }
  const hasLive = () => !!ctx.tenantId;
  async function updateTenantSettings(patch) {
    if (!ctx.tenantId) return null;
    await rest("tenants?id=eq." + ctx.tenantId, { method: "PATCH", body: JSON.stringify(patch) });
    return true;
  }

  /* ---------------- Support + system admin ---------------- */
  function sessionUserId() {
    try { const u = JSON.parse(localStorage.getItem("sh_user") || "null"); return u && u.id; } catch { return null; }
  }
  async function isSystemAdmin() {
    const uid = sessionUserId();
    if (!uid) return false;
    const rows = await rest("system_admins?user_id=eq." + uid + "&select=user_id").catch(() => []);
    return !!(rows && rows.length);
  }
  async function listSupportCases() {
    return rest("support_cases?select=*&order=updated_at.desc&limit=100");
  }
  async function createSupportCase({ subject, category, priority, body, email }) {
    const uid = sessionUserId();
    const rows = await rest("support_cases", {
      method: "POST", headers: rep,
      body: JSON.stringify({ tenant_id: ctx.tenantId, user_id: uid, requester_email: email || null, subject, category: category || "help", priority: priority || "normal", status: "open" })
    });
    const created = rows && rows[0];
    if (created && body) await addSupportMessage(created.id, body, "user", email);
    return created;
  }
  async function listSupportMessages(caseId) {
    return rest("support_messages?case_id=eq." + caseId + "&select=*&order=created_at.asc");
  }
  async function addSupportMessage(caseId, body, sender, email) {
    const rows = await rest("support_messages", {
      method: "POST", headers: rep,
      body: JSON.stringify({ case_id: caseId, tenant_id: ctx.tenantId, sender: sender || "user", author_email: email || null, body })
    });
    await rest("support_cases?id=eq." + caseId, { method: "PATCH", body: JSON.stringify({ updated_at: new Date().toISOString() }) }).catch(() => {});
    return rows && rows[0];
  }
  async function setSupportStatus(caseId, status) {
    await rest("support_cases?id=eq." + caseId, { method: "PATCH", body: JSON.stringify({ status }) });
  }
  async function adminSubscribers() {
    return rest("tenants?select=*&order=created_at.desc&limit=200");
  }
  const tenantId = () => ctx.tenantId;

  window.SHDB = {
    configured, loadLiveData, updateHK, hasLive, updateTenantSettings, tenantId,
    isSystemAdmin, listSupportCases, createSupportCase, listSupportMessages, addSupportMessage, setSupportStatus, adminSubscribers,
    createReservation, setReservationStatus, updateReservationPaid, addTransaction,
    createAddon, setAddonActive, deleteAddon, createTax, deleteTax, createRoom
  };
})();
