/* SimpleHotelier — Supabase data layer (REST, no build step).
   The dashboard only ever loads a property the signed-in user is a member
   of. There is deliberately no anonymous/demo tenant lookup here: demo mode
   is a purely local, explicit opt-in in the UI (see js/app.js, js/auth.js)
   and must never adopt a real tenant id. Only the anon (publishable) key is
   used in the browser; signed-in reads send the user's access token from
   localStorage ("sh_access_token"). */
"use strict";

(function () {
  const cfg = window.SH_CONFIG || {};
  const ANCHOR = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(); // local "today"; offsets (inN/outN) count from here
  const DAY = 864e5;
  const configured = () => !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  function token() {
    try { return localStorage.getItem("sh_access_token") || cfg.SUPABASE_ANON_KEY; }
    catch { return cfg.SUPABASE_ANON_KEY; }
  }

  /* Access tokens expire (1h by default); the refresh token saved at login is
     exchanged for a fresh pair before it lapses. Without this, every write
     starts failing with 401 mid-session while public reads keep working. */
  function tokenExpiry(t) {
    try {
      const part = String(t).split(".")[1];
      const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
      return (payload.exp || 0) * 1000;
    } catch { return 0; }
  }
  let refreshInFlight = null;
  async function freshToken() {
    const current = token();
    if (!current || current === cfg.SUPABASE_ANON_KEY) return current;
    if (tokenExpiry(current) - Date.now() > 120000) return current; // still fresh
    let refresh = null;
    try { refresh = localStorage.getItem("sh_refresh_token"); } catch { /* no storage */ }
    if (!refresh) return current;
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token", {
            method: "POST",
            headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refresh })
          });
          if (!res.ok) return null;
          const data = await res.json();
          if (data.access_token) localStorage.setItem("sh_access_token", data.access_token);
          if (data.refresh_token) localStorage.setItem("sh_refresh_token", data.refresh_token);
          if (data.user) localStorage.setItem("sh_user", JSON.stringify({ id: data.user.id, email: data.user.email || "" }));
          return data.access_token || null;
        } catch { return null; }
        finally { refreshInFlight = null; }
      })();
    }
    return (await refreshInFlight) || current;
  }

  async function rest(path, opts = {}) {
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, {
      ...opts,
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (await freshToken()),
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });
    if (!res.ok) {
      // Keep PostgREST's code + sentence (e.g. currency_locked) for the UI.
      const data = await res.json().catch(() => null);
      const err = new Error("Supabase " + res.status + " on " + path);
      err.status = res.status;
      err.code = (data && data.message) || "";
      err.details = (data && data.details) || "";
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  /* PostgREST answers at most 1000 rows per request (the project's max_rows)
     and silently stops there, so longer lists are read page by page. `path`
     must be ordered by something unique (end the order with id). */
  const PAGE = 1000;
  async function restAll(path, max = 20000) {
    const out = [];
    for (let offset = 0; offset < max; offset += PAGE) {
      const rows = await rest(path + "&limit=" + PAGE + "&offset=" + offset);
      out.push(...(rows || []));
      if (!rows || rows.length < PAGE) break;
    }
    return out;
  }

  /* The dashboard loads stays from the last HISTORY_DAYS onward plus anything
     still owing; older history loads on request (loadOlderReservations). */
  const HISTORY_DAYS = 400;
  const isoDay = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const historyCutoff = () => isoDay(ANCHOR.getTime() - HISTORY_DAYS * DAY);

  /* Database functions raise with message = an error code and details = a
     sentence for people; keep both so the UI can show the sentence. */
  async function rpc(name, body) {
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + (await freshToken()), "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && (data.details || data.message)) || ("Request failed (" + res.status + ")"));
      err.code = (data && data.message) || "";
      throw err;
    }
    return data;
  }

  /* Room types: DB columns (cents, snake_case) <-> app shape (dollars, camelCase). */
  const arr = (v) => (Array.isArray(v) ? v : []);
  function mapRoomType(t) {
    return {
      id: t.id, name: t.name, desc: t.description || "",
      bathrooms: t.bathrooms != null ? Number(t.bathrooms) : 1,
      view: t.view || "", smoking: t.smoking_policy || "non-smoking",
      minStay: t.min_stay != null ? t.min_stay : 1, maxStay: t.max_stay || 0,
      rackRate: (t.rack_rate_cents || 0) / 100,
      extraAdultRate: (t.extra_adult_cents || 0) / 100,
      extraChildRate: (t.extra_child_cents || 0) / 100,
      extraInfantRate: (t.extra_infant_cents || 0) / 100,
      includedAdults: t.included_adults != null ? t.included_adults : 2,
      includedChildren: t.included_children || 0, includedInfants: t.included_infants || 0,
      maxAdults: t.max_adults || 0, maxChildren: t.max_children || 0,
      maxInfants: t.max_infants || 0, maxOccupants: t.max_occupants || 0,
      adultsRequired: t.adults_required != null ? t.adults_required : 1,
      beds: arr(t.beds), handicapAccessible: !!t.handicap_accessible,
      accessibleFeatures: arr(t.accessible_features), features: arr(t.features), photos: arr(t.photos),
      ratePlans: arr(t.rate_plans)
    };
  }
  function roomTypePayload(t) {
    const cents = (n) => Math.round((Number(n) || 0) * 100);
    const int = (n, d) => { const v = parseInt(n, 10); return Number.isFinite(v) ? v : d; };
    return {
      name: t.name, description: t.desc || null,
      bathrooms: Number(t.bathrooms) || 1, view: t.view || null,
      smoking_policy: t.smoking || "non-smoking",
      min_stay: int(t.minStay, 1), max_stay: int(t.maxStay, 0),
      rack_rate_cents: cents(t.rackRate),
      extra_adult_cents: cents(t.extraAdultRate), extra_child_cents: cents(t.extraChildRate), extra_infant_cents: cents(t.extraInfantRate),
      included_adults: int(t.includedAdults, 2), included_children: int(t.includedChildren, 0), included_infants: int(t.includedInfants, 0),
      max_adults: int(t.maxAdults, 0), max_children: int(t.maxChildren, 0), max_infants: int(t.maxInfants, 0), max_occupants: int(t.maxOccupants, 0),
      adults_required: int(t.adultsRequired, 1),
      beds: arr(t.beds), handicap_accessible: !!t.handicapAccessible,
      accessible_features: arr(t.accessibleFeatures), features: arr(t.features), photos: arr(t.photos),
      rate_plans: arr(t.ratePlans)
    };
  }

  const dayOff = (iso) => Math.round((new Date(iso + "T12:00:00") - ANCHOR) / DAY);
  const mapStatus = (s) => ({ checked_in: "checked-in", checked_out: "checked-out" }[s] || s);
  const statusIn = (s) => ({ "checked-in": "checked_in", "checked-out": "checked_out" }[s] || s);
  const ctx = { tenantId: null, roomIdByCode: {}, roomCodeById: {} }; // set by loadLiveData; writes no-op without it

  /* Reservation row -> app shape. inN/outN are day offsets from today (lists,
     calendar); checkIn/checkOut keep the real dates for the editor. */
  function mapReservation(r) {
    return {
      id: r.id, ref: r.confirmation_code, guest: r.guest_name,
      contact: r.guest_email || r.guest_phone || "—", email: r.guest_email || "", phone: r.guest_phone || "",
      room: ctx.roomCodeById[r.room_id] || "—", roomId: r.room_id,
      checkIn: String(r.check_in).slice(0, 10), checkOut: String(r.check_out).slice(0, 10),
      inN: dayOff(r.check_in), outN: dayOff(r.check_out),
      status: mapStatus(r.status), source: r.source || "direct", icalFeedId: r.ical_feed_id || null, arrival: r.arrival_time || "",
      total: (r.total_cents || 0) / 100, paid: (r.paid_cents || 0) / 100, notes: r.notes || "",
      card: r.card_last4 ? { brand: r.card_brand || "card", last4: r.card_last4 } : null
    };
  }

  /* One login can belong to several properties. The one in use is remembered
     per browser; without a remembered (and still valid) one, the oldest
     membership opens. */
  const TENANT_KEY = "sh_tenant";
  const rememberedTenant = () => { try { return localStorage.getItem(TENANT_KEY) || ""; } catch { return ""; } };
  function rememberTenant(id) { try { localStorage.setItem(TENANT_KEY, String(id || "")); } catch { /* no storage */ } }

  /* Signed-in path: resolve the user's tenant via tenant_members (RLS-safe). */
  async function memberTenant() {
    const t = await freshToken();
    if (!t || t === cfg.SUPABASE_ANON_KEY) return null;
    try {
      const ures = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/user", {
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + t }
      });
      if (!ures.ok) return null;
      const user = await ures.json();
      const mems = await rest("tenant_members?user_id=eq." + user.id + "&select=tenant_id,role,created_at&order=created_at.asc,tenant_id.asc&limit=200");
      if (!mems || !mems.length) return { user, tenant: null, memberships: [] };
      const mem = mems.find((m) => m.tenant_id === rememberedTenant()) || mems[0];
      // member_tenant() adds the calendar token and billing ids for owners and
      // admins only (20261123000000_security_cleanup); browsers can't read
      // those columns directly. The plain read covers a not-yet-migrated db.
      const tenant = await rpc("member_tenant", { p_tenant: mem.tenant_id })
        .catch(() => rest("tenants?id=eq." + mem.tenant_id + "&select=*").then((rows) => rows && rows[0]).catch(() => null));
      const names = {};
      if (mems.length > 1) {
        const rows = await rest("tenants?id=in.(" + mems.map((m) => m.tenant_id).join(",") + ")&select=id,name").catch(() => []);
        (rows || []).forEach((r) => { names[r.id] = r.name; });
      }
      if (tenant && tenant.id) names[tenant.id] = tenant.name;
      const memberships = mems.map((m) => ({ id: m.tenant_id, role: m.role, name: names[m.tenant_id] || "Property" }));
      return { user, role: mem.role, tenant: tenant && tenant.id ? tenant : null, memberships };
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
      }
      if (!tenant) {
        // No signed-in member, no data. Never fall back to a named "demo"
        // tenant: that would load a real property into an anonymous
        // session and adopt its id for writes (hasLive() === true).
        return { tenant: null, user, rooms: [], reservations: [], addons: [], taxes: [], roomTypes: [], txns: [], tickets: [], icalFeeds: [] };
      }
      const tid = "tenant_id=eq." + tenant.id;
      ctx.tenantId = tenant.id;
      const cutoff = historyCutoff();
      /* Each role loads only what it may see (20261122000000_role_scoped_access):
         the front desk everything; cleaners rooms, tickets and the turnover
         list; maintenance rooms and tickets. */
      const role = mt.role || "staff";
      const desk = role === "owner" || role === "admin" || role === "staff";
      const none = () => Promise.resolve([]);
      const [rooms, reservations, addons, taxes, roomTypesRaw, overridesRaw, olderRows, turnoverRows] = await Promise.all([
        restAll("rooms?" + tid + "&select=*&order=sort_order.asc,id.asc"),
        desk ? restAll("reservations?" + tid + "&or=(check_out.gte." + cutoff + ",and(balance_cents.gt.0,status.neq.cancelled))&select=*&order=check_in.asc,id.asc") : none(),
        desk ? restAll("addons?" + tid + "&select=*&order=name.asc,id.asc") : none(),
        desk ? restAll("tax_rules?" + tid + "&select=*&order=sort_order.asc,id.asc") : none(),
        desk ? restAll("room_types?" + tid + "&select=*&order=name.asc,id.asc").catch(() => []) : none(),
        // Past nights can't be booked or re-priced; keep a month for context.
        desk ? restAll("room_rate_overrides?" + tid + "&date=gte." + isoDay(ANCHOR.getTime() - 31 * DAY) + "&select=*&order=date.asc,room_type_id.asc").catch(() => []) : none(),
        desk ? rest("reservations?" + tid + "&check_out=lt." + cutoff + "&select=id&limit=1").catch(() => []) : none(),
        role !== "maintenance" ? rpc("housekeeping_turnovers", { p_tenant: tenant.id, p_from: isoDay(ANCHOR.getTime()), p_days: 2 }).catch(() => []) : none()
      ]);
      const typeNameById = {};
      const typePhotosById = {};
      (roomTypesRaw || []).forEach((t) => { typeNameById[t.id] = t.name; typePhotosById[t.id] = arr(t.photos); });
      ctx.roomIdByCode = {};
      ctx.roomCodeById = {};
      rooms.forEach((r) => { ctx.roomIdByCode[r.code] = r.id; ctx.roomCodeById[r.id] = r.code; });
      // Open tickets, plus ones closed in the last 90 days.
      const recent = new Date(ANCHOR.getTime() - 90 * DAY).toISOString();
      const ticketRows = await rest("maintenance_tickets?" + tid + "&or=(status.neq.done,resolved_at.gte." + recent + ",created_at.gte." + recent + ")&select=*&order=created_at.desc,id.desc&limit=500").catch(() => []);
      const feedRows = desk ? await rest("ical_feeds?" + tid + "&select=*&order=created_at.asc&limit=500").catch(() => []) : [];
      // Payments view: the last 30 days ("Collected" is that window's total).
      const txnRows = desk ? await restAll("transactions?" + tid + "&created_at=gte." + new Date(ANCHOR.getTime() - 30 * DAY).toISOString() + "&select=*&order=created_at.desc,id.desc").catch(() => []) : [];
      const anyTxn = desk ? await rest("transactions?" + tid + "&select=id&limit=1").catch(() => []) : [];
      const memberRows = await rest("tenant_members?" + tid + "&select=user_id").catch(() => []);
      const roomCode = (id) => ctx.roomCodeById[id] || "—";
      return {
        tenant, user, role, memberships: mt.memberships || [], membersCount: (memberRows || []).length,
        // Housekeeping's turnover list: rooms and dates, no guest details.
        turnovers: (turnoverRows || []).map((t) => ({
          roomId: t.room_id, roomCode: roomCode(t.room_id),
          inN: dayOff(t.check_in), outN: dayOff(t.check_out), status: mapStatus(t.status),
          guests: (t.adults || 0) + (t.children || 0) + (t.infants || 0)
        })),
        olderReservations: !!(olderRows && olderRows.length),
        hasPayments: !!(anyTxn && anyTxn.length),
        rooms: rooms.map((r) => ({
          id: r.id, code: r.code, name: r.name,
          sleeps: r.sleeps || 2, typeId: r.room_type_id || null,
          typeName: typeNameById[r.room_type_id] || "",
          type: ((typeNameById[r.room_type_id] ? typeNameById[r.room_type_id] + " · " : "") + "Sleeps " + (r.sleeps || 2)),
          rate: (r.rate_cents || 0) / 100, status: r.status,
          hk: r.housekeeping_status, guest: "", note: r.notes || "",
          photos: Array.isArray(r.photos) && r.photos.length ? r.photos : (typePhotosById[r.room_type_id] || [])
        })),
        roomTypes: (roomTypesRaw || []).map(mapRoomType),
        rateOverrides: (overridesRaw || []).map((o) => ({
          typeId: o.room_type_id, date: String(o.date || "").slice(0, 10), rate: (o.rate_cents || 0) / 100,
          minStay: o.min_stay != null ? o.min_stay : null, maxStay: o.max_stay != null ? o.max_stay : null,
          closed: !!o.closed, cta: !!o.cta, ctd: !!o.ctd
        })),
        reservations: reservations.map(mapReservation),
        tickets: (ticketRows || []).map((t) => ({
          id: t.id, roomId: t.room_id, roomCode: t.room_id ? roomCode(t.room_id) : "",
          title: t.title, desc: t.description || "", photo: t.photo_url || "",
          priority: t.priority || "normal", status: t.status || "open",
          when: new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        })),
        icalFeeds: (feedRows || []).map((f) => ({
          id: f.id, roomId: f.room_id, roomCode: f.room_id ? roomCode(f.room_id) : "",
          name: f.name, source: f.source || "airbnb", url: f.url,
          lastSynced: f.last_synced_at, lastError: f.last_error || ""
        })),
        addons: addons.map((a) => ({ id: a.id, name: a.name, price: (a.price_cents || 0) / 100, per: a.per, on: a.active, desc: a.description || "" })),
        taxes: taxes.map((t) => ({ id: t.id, name: t.name, kind: t.kind, value: Number(t.rate), applies: t.applies_to, on: t.active })),
        txns: (txnRows || []).map((t) => ({
          when: new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          desc: t.description, method: t.method || "Card", status: t.status, amount: (t.amount_cents || 0) / 100
        }))
      };
    } catch (err) {
      console.warn("[SimpleHotelier] Live load failed:", err.message);
      if (window.SHReportError) window.SHReportError(err, "dashboard load");
      return null;
    }
  }

  /* Older history, newest first, a page at a time (the dashboard already has
     everything since historyCutoff() and anything still owing). */
  const OLDER_PAGE = 200;
  async function loadOlderReservations(offset) {
    if (!ctx.tenantId) return { rows: [], more: false };
    const rows = await rest("reservations?tenant_id=eq." + ctx.tenantId + "&check_out=lt." + historyCutoff() +
      "&select=*&order=check_in.desc,id.desc&limit=" + OLDER_PAGE + "&offset=" + (offset | 0));
    return { rows: (rows || []).map(mapReservation), more: (rows || []).length === OLDER_PAGE };
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
      body: JSON.stringify({ tenant_id: ctx.tenantId, code: r.code, name: r.name, sleeps: r.sleeps || 2, rate_cents: Math.round((r.rate || 0) * 100), room_type_id: r.typeId || null, status: "vacant", housekeeping_status: "clean" })
    });
    return rows && rows[0];
  }
  async function updateRoom(id, r) {
    if (!id) return;
    const patch = {};
    if (r.name != null) patch.name = r.name;
    if (r.sleeps != null) patch.sleeps = r.sleeps;
    if (r.rate != null) patch.rate_cents = Math.round(r.rate * 100);
    if ("typeId" in r) patch.room_type_id = r.typeId || null;
    if (r.notes != null) patch.notes = r.notes;
    if (r.photos != null) patch.photos = r.photos;
    await rest("rooms?id=eq." + id, { method: "PATCH", body: JSON.stringify(patch) });
  }
  async function createRoomType(t) {
    if (!ctx.tenantId) return null;
    const rows = await rest("room_types", { method: "POST", headers: rep, body: JSON.stringify({ tenant_id: ctx.tenantId, ...roomTypePayload(t) }) });
    return rows && rows[0];
  }
  async function updateRoomType(id, t) {
    if (!id) return;
    await rest("room_types?id=eq." + id, { method: "PATCH", body: JSON.stringify(roomTypePayload(t)) });
  }
  async function deleteRoomType(id) { if (id) await rest("room_types?id=eq." + id, { method: "DELETE" }); }
  async function upsertRateOverrides(typeId, entries) {
    if (!ctx.tenantId || !typeId || !entries.length) return;
    await rest("room_rate_overrides?on_conflict=room_type_id,date", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(entries.map((e) => ({
        tenant_id: ctx.tenantId, room_type_id: typeId, date: e.date,
        rate_cents: Math.round((e.rate || 0) * 100),
        min_stay: e.minStay != null ? e.minStay : null,
        max_stay: e.maxStay != null ? e.maxStay : null,
        closed: !!e.closed, cta: !!e.cta, ctd: !!e.ctd
      })))
    });
  }
  async function deleteRateOverride(typeId, date) {
    if (!typeId) return;
    await rest("room_rate_overrides?room_type_id=eq." + typeId + "&date=eq." + date, { method: "DELETE" });
  }
  async function uploadPublic(bucket, path, file) {
    const baseUrl = cfg.SUPABASE_URL.replace(/\/$/, "");
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(baseUrl + "/storage/v1/object/" + bucket + "/" + encoded, {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + (await freshToken()), "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
      body: file
    });
    if (!res.ok) throw new Error("Upload failed (" + res.status + ")");
    return baseUrl + "/storage/v1/object/public/" + bucket + "/" + encoded;
  }
  /* ---------------- Reservation editor ---------------- */
  /* Everything the editor shows for one booking: the full row, its add-ons
     and its money movements (oldest first). */
  async function reservationBundle(id) {
    const [rows, addonRows, txnRows] = await Promise.all([
      rest("reservations?id=eq." + id + "&select=*"),
      rest("reservation_addons?reservation_id=eq." + id + "&select=addon_id,name_snapshot,price_cents"),
      rest("transactions?reservation_id=eq." + id + "&select=*&order=created_at.asc")
    ]);
    const row = rows && rows[0];
    return row ? { row, mapped: mapReservation(row), addons: addonRows || [], txns: txnRows || [] } : null;
  }
  const staffQuote = (q) => rpc("staff_quote", { p_tenant: ctx.tenantId, ...q });
  async function saveReservation(params) {
    const row = await rpc("save_reservation", { p_tenant: ctx.tenantId, ...params });
    return { row, mapped: mapReservation(row) };
  }
  const recordManualPayment = (reservationId, amountCents, method, note) =>
    rpc("record_manual_payment", { p_reservation: reservationId, p_amount_cents: amountCents, p_method: method, p_note: note || null });

  /* ---------------- Team invites ---------------- */
  async function listInvites() {
    if (!ctx.tenantId) return [];
    const rows = await rest("invites?tenant_id=eq." + ctx.tenantId + "&accepted_at=is.null&select=id,email,role,created_at&order=created_at.desc").catch(() => []);
    return (rows || []).map((i) => ({ id: i.id, email: i.email, role: i.role, when: new Date(i.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) }));
  }
  async function deleteInvite(id) { if (id) await rest("invites?id=eq." + id, { method: "DELETE" }); }

  /* ---------------- Team members (owners/admins; RLS decides) ---------------- */
  async function teamMembers() {
    if (!ctx.tenantId) return [];
    const rows = await rpc("team_members", { p_tenant: ctx.tenantId });
    return (rows || []).map((m) => ({ userId: m.user_id, role: m.role, email: m.email || "", name: m.name || "", me: !!m.is_me }));
  }
  /* Role change / removal; zero rows back means the policies refused it. */
  async function changeMember(userId, patch) {
    const path = "tenant_members?tenant_id=eq." + ctx.tenantId + "&user_id=eq." + userId;
    const rows = await rest(path, patch ? { method: "PATCH", headers: rep, body: JSON.stringify(patch) } : { method: "DELETE", headers: rep });
    if (!rows || !rows.length) {
      const err = new Error("not allowed");
      err.details = "You don't have permission to change this team member.";
      throw err;
    }
  }
  const setMemberRole = (userId, role) => changeMember(userId, { role });
  const removeMember = (userId) => changeMember(userId, null);

  /* ---------------- Maintenance tickets + iCal feeds ---------------- */
  async function createTicket(t) {
    if (!ctx.tenantId) return null;
    const rows = await rest("maintenance_tickets", {
      method: "POST", headers: rep,
      body: JSON.stringify({
        tenant_id: ctx.tenantId, room_id: t.roomId || null, title: t.title,
        description: t.desc || null, photo_url: t.photo || null, priority: t.priority || "normal", status: "open"
      })
    });
    return rows && rows[0];
  }
  async function setTicketStatus(id, status) {
    if (!id) return;
    const patch = { status };
    if (status === "done") patch.resolved_at = new Date().toISOString();
    if (status === "open") patch.resolved_at = null;
    await rest("maintenance_tickets?id=eq." + id, { method: "PATCH", body: JSON.stringify(patch) });
  }
  async function deleteTicket(id) { if (id) await rest("maintenance_tickets?id=eq." + id, { method: "DELETE" }); }
  async function createIcalFeed(f) {
    if (!ctx.tenantId) return null;
    const rows = await rest("ical_feeds", {
      method: "POST", headers: rep,
      body: JSON.stringify({ tenant_id: ctx.tenantId, room_id: f.roomId, name: f.name, source: f.source || "airbnb", url: f.url })
    });
    return rows && rows[0];
  }
  async function deleteIcalFeed(id) { if (id) await rest("ical_feeds?id=eq." + id, { method: "DELETE" }); }

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
    return restAll("tenants?select=id,name,slug,contact_email,subscription_status,current_period_end,created_at&order=created_at.desc,id.asc");
  }
  /* Browser errors reported by js/error-report.js (system admins only, RLS). */
  async function adminErrors() {
    return rest("client_errors?select=*&order=last_seen.desc&limit=100");
  }
  const tenantId = () => ctx.tenantId;

  window.SHDB = {
    configured, loadLiveData, updateHK, hasLive, updateTenantSettings, tenantId, freshToken, rememberTenant,
    isSystemAdmin, listSupportCases, createSupportCase, listSupportMessages, addSupportMessage, setSupportStatus, adminSubscribers, adminErrors,
    loadOlderReservations,
    createReservation, setReservationStatus, updateReservationPaid, addTransaction,
    createAddon, setAddonActive, deleteAddon, createTax, deleteTax, createRoom, updateRoom,
    createRoomType, updateRoomType, deleteRoomType, upsertRateOverrides, deleteRateOverride, uploadPublic,
    createTicket, setTicketStatus, deleteTicket, createIcalFeed, deleteIcalFeed,
    listInvites, deleteInvite, teamMembers, setMemberRole, removeMember,
    reservationBundle, staffQuote, saveReservation, recordManualPayment
  };
})();
