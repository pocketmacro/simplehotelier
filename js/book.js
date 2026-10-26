/* SimpleHotelier — public booking page (also used as the embed widget).
   Public reads + booking requests via Supabase anon key (RLS-protected).
   Optional Google Analytics (per-property ID wins over system default)
   and an optional post-booking redirect for conversion tracking. */
"use strict";

(function () {
  const round2 = (n) => Math.round(n * 100) / 100;

  /* Pure price math — covered by tests/book-calc.test.mjs */
  function quote({ rate, nights, guests, addons, taxes }) {
    const subtotal = round2((rate || 0) * (nights || 0));
    let addonsTotal = 0;
    const addonLines = (addons || []).map((a) => {
      const per = a.per || "stay";
      const mult = per === "night" ? nights : per === "person" ? guests : 1;
      const amt = round2((a.price || 0) * mult * (a.qty || 1));
      addonsTotal += amt;
      return { name: a.name, amount: amt };
    });
    addonsTotal = round2(addonsTotal);
    let taxTotal = 0;
    const taxLines = (taxes || []).map((t) => {
      let amt = 0;
      if (t.kind === "percent") {
        const base = /Room only/i.test(t.applies || "") ? subtotal : subtotal + addonsTotal;
        amt = round2(base * (Number(t.value) || 0) / 100);
      } else {
        amt = round2((Number(t.value) || 0) * (nights || 0));
      }
      taxTotal += amt;
      return { name: t.name, amount: amt };
    });
    taxTotal = round2(taxTotal);
    return { subtotal, addonsTotal, taxTotal, total: round2(subtotal + addonsTotal + taxTotal), addonLines, taxLines };
  }
  window.SHBookCalc = { quote };

  /* ---- DOM app (skipped when loaded headlessly, e.g. by tests) ---- */
  if (!document.querySelector || !document.querySelector("#roomsList")) return;

  const cfg = window.SH_CONFIG || {};
  const base = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
  const anon = cfg.SUPABASE_ANON_KEY || "";
  const params = new URLSearchParams(location.search);
  const slug = params.get("property") || params.get("slug") || cfg.TENANT_SLUG || "pinecrest";
  const isEmbed = params.get("embed") === "1";
  if (isEmbed) document.body.classList.add("embed");

  const $ = (s) => document.querySelector(s);
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { tenant: null, rooms: [], addons: [], taxes: [], selected: null, available: null, gaId: "" };

  function showError(msg) {
    const el = $("#bookError");
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function postHeight() {
    if (!isEmbed || !window.parent || window.parent === window) return;
    window.parent.postMessage({ type: "simplehotelier:height", height: document.body.scrollHeight }, "*");
  }
  if (isEmbed && window.ResizeObserver) new ResizeObserver(postHeight).observe(document.body);

  async function api(path, opts = {}) {
    const res = await fetch(base + "/rest/v1/" + path, {
      ...opts,
      headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.details || ("Request failed (" + res.status + ")"));
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  /* Google Analytics: per-property Measurement ID, else system default. */
  function setupGA() {
    const id = (state.tenant && state.tenant.ga_measurement_id) || cfg.GOOGLE_ANALYTICS_ID || "";
    state.gaId = id;
    if (!id || window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
    window.gtag("js", new Date());
    window.gtag("config", id);
  }
  function trackConversion(code, total) {
    if (state.gaId && window.gtag) {
      const payload = { transaction_id: code, value: total, currency: (state.tenant && state.tenant.currency) || "USD" };
      window.gtag("event", "purchase", payload);        // GA4 recommended commerce event
      window.gtag("event", "booking_complete", payload); // explicit custom conversion
    }
    const redirect = state.tenant && state.tenant.booking_redirect_url;
    if (redirect) {
      try {
        const u = new URL(redirect);
        u.searchParams.set("booking_ref", code);
        u.searchParams.set("total", total);
        u.searchParams.set("currency", (state.tenant && state.tenant.currency) || "USD");
        $("#redirectLink").href = u.toString();
        $("#redirectNote").hidden = false;
        setTimeout(() => { location.href = u.toString(); }, 1500);
      } catch { /* invalid URL saved in settings: stay on thank-you panel */ }
    }
  }

  function nights() {
    const a = new Date($("#inDate").value + "T12:00:00");
    const b = new Date($("#outDate").value + "T12:00:00");
    return Math.round((b - a) / 864e5);
  }
  function chosenAddons() {
    return [...document.querySelectorAll("#addonsList input:checked")].map((el) => state.addons[+el.dataset.i]);
  }

  function renderRooms() {
    const n = Math.max(1, nights() || 1);
    $("#roomsList").innerHTML = state.rooms.map((r) => {
      const booked = state.available && !state.available.includes(r.id);
      const sel = state.selected && state.selected.id === r.id;
      return `<article class="bk-room${sel ? " sel" : ""}${booked ? " booked" : ""}">
        <h3>${esc(r.name)}</h3>
        <div class="meta">Sleeps ${esc(r.sleeps)} · ${esc(r.code)}</div>
        <div class="price"><div><b>${money(r.rate_cents / 100)}</b> <span>/ night · ${money(r.rate_cents / 100 * n)} for ${n} night${n > 1 ? "s" : ""}</span></div>
        <button class="bk-select" type="button" data-room="${r.id}" ${booked ? "disabled" : ""}>${booked ? "Booked" : sel ? "Selected ✓" : "Select"}</button></div>
      </article>`;
    }).join("") || `<p class="bk-loading">No rooms are listed yet.</p>`;
    postHeight();
  }
  function renderAddons() {
    const wrap = $("#addonsSection");
    wrap.hidden = !state.addons.length;
    $("#addonsList").innerHTML = state.addons.map((a, i) => `
      <label class="bk-addon"><input type="checkbox" data-i="${i}">
        <span><strong>${esc(a.name)} · ${money(a.price_cents / 100)}<small> / ${esc(a.per)}</small></strong><span>${esc(a.description || "")}</span></span>
      </label>`).join("");
    [...document.querySelectorAll("#addonsList input")].forEach((el) => el.addEventListener("change", renderSummary));
  }
  function renderSummary() {
    const n = nights();
    const btn = $("#bookBtn");
    if (!state.selected || !n || n < 1) {
      $("#summaryBody").innerHTML = `<p class="bk-muted">${!state.selected ? "Pick dates and a room to see your total." : "Check-out must be after check-in."}</p>`;
      btn.disabled = true;
      btn.textContent = state.selected ? "Fix your dates" : "Select a room to continue";
      return null;
    }
    const guests = Math.max(1, parseInt($("#guests").value) || 1);
    const q = quote({ rate: state.selected.rate_cents / 100, nights: n, guests, addons: chosenAddons().map((a) => ({ name: a.name, price: a.price_cents / 100, per: a.per, qty: 1 })), taxes: state.taxes });
    $("#summaryBody").innerHTML =
      `<div class="bk-line"><span>${esc(state.selected.name)} × ${n} night${n > 1 ? "s" : ""}</span><b>${money(q.subtotal)}</b></div>` +
      q.addonLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      q.taxLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      `<div class="bk-line total"><span>Total</span><b>${money(q.total)}</b></div>`;
    btn.disabled = false;
    btn.textContent = "Request booking · " + money(q.total);
    postHeight();
    return q;
  }

  async function checkAvailability() {
    try {
      const rows = await api("rpc/get_available_room_ids", {
        method: "POST",
        body: JSON.stringify({ p_tenant: state.tenant.id, p_check_in: $("#inDate").value, p_check_out: $("#outDate").value })
      });
      state.available = (rows || []).map((r) => (typeof r === "string" ? r : r.get_available_room_ids));
      $("#availNote").hidden = false;
      $("#availNote").textContent = state.available.length + " of " + state.rooms.length + " rooms available for these dates.";
    } catch {
      state.available = null; // availability function not installed yet: constraint still protects at submit
      $("#availNote").hidden = false;
      $("#availNote").textContent = "Showing all rooms — the property confirms availability with your request.";
    }
    if (state.selected && state.available && !state.available.includes(state.selected.id)) state.selected = null;
    renderRooms(); renderSummary();
  }

  async function load() {
    if (!base || !anon) { showError("Booking is not configured yet. Please contact the property directly."); return; }
    try {
      const tenants = await api("tenants?slug=eq." + encodeURIComponent(slug) + "&select=*");
      state.tenant = tenants && tenants[0];
      if (!state.tenant) { showError("We could not find this property. Check the link and try again."); return; }
      const t = state.tenant;
      document.title = "Book · " + t.name;
      $("#propName").textContent = t.name;
      $("#propMark").textContent = (t.name || "S").slice(0, 1).toUpperCase();
      $("#propHeadline").textContent = t.booking_headline || ("Stay at " + t.name);
      $("#propSub").textContent = t.booking_subheading || "";
      if (t.brand_color) {
        document.documentElement.style.setProperty("--brand", t.brand_color);
        document.documentElement.style.setProperty("--brand-2", t.brand_color);
      }
      setupGA();
      const tid = "tenant_id=eq." + t.id;
      const [rooms, addons, taxes] = await Promise.all([
        api("rooms?" + tid + "&select=*&order=sort_order.asc"),
        api("addons?" + tid + "&active=eq.true&select=*&order=name.asc"),
        api("tax_rules?" + tid + "&active=eq.true&select=*&order=sort_order.asc")
      ]);
      state.rooms = rooms || [];
      state.addons = addons || [];
      state.taxes = (taxes || []).map((x) => ({ name: x.name, kind: x.kind, value: Number(x.rate), applies: x.applies_to }));
      renderRooms(); renderAddons(); renderSummary(); postHeight();
    } catch (e) {
      showError("Booking is temporarily unavailable. Please contact the property directly.");
    }
  }

  /* Defaults: a week out, two nights. */
  const d = (off) => { const x = new Date(Date.now() + off * 864e5); return x.toISOString().slice(0, 10); };
  $("#inDate").value = d(7);
  $("#outDate").value = d(9);

  $("#roomsList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-room]");
    if (!b || b.disabled) return;
    state.selected = state.rooms.find((r) => r.id === b.dataset.room) || null;
    renderRooms(); renderSummary();
  });
  ["inDate", "outDate", "guests"].forEach((id) => $("#" + id).addEventListener("change", () => { renderRooms(); renderSummary(); }));
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); showError(""); checkAvailability(); });

  $("#bookBtn").addEventListener("click", async () => {
    showError("");
    const name = $("#gName").value.trim();
    const email = $("#gEmail").value.trim();
    if (!state.selected) { showError("Please select a room first."); return; }
    if (!name || !email) { showError("Please add your name and email so the property can confirm."); $("#gName").focus(); return; }
    const q = renderSummary();
    if (!q) { showError("Please fix your dates."); return; }
    const btn = $("#bookBtn");
    btn.disabled = true; btn.textContent = "Sending…";
    const code = "SH-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const resId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2));
    const selAddons = chosenAddons();
    const notes = [$("#gNotes").value.trim(), selAddons.length ? "Add-ons: " + selAddons.map((a) => a.name).join(", ") : ""].filter(Boolean).join(" · ");
    try {
      await api("reservations", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          id: resId, tenant_id: state.tenant.id, room_id: state.selected.id,
          guest_name: name, guest_email: email, guest_phone: $("#gPhone").value.trim() || null,
          confirmation_code: code, check_in: $("#inDate").value, check_out: $("#outDate").value,
          status: "pending", source: "direct", adults: Math.max(1, parseInt($("#guests").value) || 1),
          notes: notes || null,
          subtotal_cents: Math.round(q.subtotal * 100), tax_cents: Math.round(q.taxTotal * 100),
          total_cents: Math.round(q.total * 100), paid_cents: 0
        })
      });
      // Attach add-on snapshots (best effort; the request itself already succeeded).
      for (const a of selAddons) {
        await api("reservation_addons", {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ tenant_id: state.tenant.id, reservation_id: resId, addon_id: a.id, name_snapshot: a.name, price_cents: a.price_cents, qty: 1 })
        }).catch(() => {});
      }
      document.querySelector(".bk-layout").style.display = "none";
      $("#searchForm").style.display = "none";
      $("#availNote").hidden = true;
      $("#successText").textContent = "Thanks " + name.split(" ")[0] + " — " + state.tenant.name + " will confirm your " + state.selected.name + " stay by email shortly.";
      $("#successCode").textContent = "Confirmation " + code + " · Total " + money(q.total);
      const panel = $("#successPanel");
      panel.hidden = false;
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
      trackConversion(code, q.total);
      postHeight();
    } catch (e) {
      btn.disabled = false; btn.textContent = "Request booking";
      showError(/exclusion|conflict|duplicate|409/i.test(e.message)
        ? "Those dates just became unavailable for this room. Try different dates or another room."
        : "Something went wrong sending your request. Please try again or contact the property.");
    }
  });

  load();
})();
