/* SimpleHotelier — public booking page (also used as the embed widget).
   Public reads + booking requests via Supabase anon key (RLS-protected).
   Optional Google Analytics (per-property ID wins over system default)
   and an optional post-booking redirect for conversion tracking. */
"use strict";

(function () {
  const round2 = (n) => Math.round(n * 100) / 100;

  /* Pure price math — covered by tests/book-calc.test.mjs */
  function quote({ rate, nights, guests, addons, taxes, nightlyRates }) {
    const subtotal = nightlyRates && nightlyRates.length
      ? round2(nightlyRates.reduce((a, b) => a + b, 0))
      : round2((rate || 0) * (nights || 0));
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
  /* Pure rate-plan math — covered by tests/book-calc.test.mjs */
  function applyPlanToRates(rates, plan) {
    if (!plan) return rates.slice();
    return rates.map((v) => plan.rateKind === "flat"
      ? Math.max(0, Math.round((v + (Number(plan.difference) || 0)) * 100) / 100)
      : Math.max(0, Math.round(v * (1 + (Number(plan.difference) || 0) / 100) * 100) / 100));
  }
  function planApplies(plan, { nights, leadDays, promoCode }) {
    if (!plan) return false;
    if (plan.minStay && nights < plan.minStay) return false;
    if (plan.maxStay && nights > plan.maxStay) return false;
    if (plan.releasePeriod && leadDays < plan.releasePeriod) return false;
    if (plan.promoCode && String(plan.promoCode).toUpperCase() !== String(promoCode || "").trim().toUpperCase()) return false;
    return true;
  }
  /* Book-by-type: units of a type that can still take the stay, in assign order.
     availableIds null = availability unknown, so every unit is a candidate. */
  function chooseUnits(units, availableIds) {
    if (!availableIds) return units.slice();
    const set = new Set(availableIds);
    return units.filter((u) => set.has(u.id));
  }
  /* Owner-entered links (website, socials, redirect, hero image) must be
     plain web URLs: never javascript:/data: on a guest's page. */
  function safeUrl(raw, { httpsOnly = false } = {}) {
    try {
      const u = new URL(String(raw || "").trim());
      if (u.protocol === "https:" || (!httpsOnly && u.protocol === "http:")) return u.toString();
    } catch { /* not a URL */ }
    return "";
  }
  /* create_booking raises with message = an error code and details = a
     sentence written for guests; anything else gets a generic line. */
  function bookingErrorText(e) {
    if (e && e.details && /^[a-z_]+$/.test(e.code || "")) return e.details;
    return "Something went wrong sending your request. Please try again or contact the property.";
  }
  window.SHBookCalc = { quote, applyPlanToRates, planApplies, chooseUnits, safeUrl, bookingErrorText };

  /* ---- DOM app (skipped when loaded headlessly, e.g. by tests) ---- */
  if (!document.querySelector || !document.querySelector("#roomsList")) return;

  const cfg = window.SH_CONFIG || {};
  const base = (cfg.SUPABASE_URL || "").replace(/\/$/, "");
  const anon = cfg.SUPABASE_ANON_KEY || "";
  const params = new URLSearchParams(location.search);
  /* Property subdomains ({slug}.simplehotelier.com/book.html) name the tenant too. */
  const hostLabel = (() => {
    const h = location.hostname.toLowerCase(), suffix = ".simplehotelier.com";
    if (!h.endsWith(suffix)) return "";
    const label = h.slice(0, -suffix.length);
    return label && label.indexOf(".") === -1 && label !== "www" && /^[a-z0-9-]+$/.test(label) ? label : "";
  })();
  const slug = params.get("property") || params.get("slug") || hostLabel || cfg.TENANT_SLUG || "pinecrest";
  const isEmbed = params.get("embed") === "1";
  /* Guests land here from a payment-request link once Stripe has the payment. */
  const paidRef = (params.get("paid") || "").trim().slice(0, 40);
  if (isEmbed) document.body.classList.add("embed");

  const $ = (s) => document.querySelector(s);
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = { tenant: null, rooms: [], types: {}, addons: [], taxes: [], selected: null, selectedTypeId: null, available: null, gaId: "", overrides: {}, dep: null, booked: null, paying: null, stripe: null, cardEl: null };
  /* Properties choose: guests book a room type (we auto-assign a unit) or the exact room.
     Safety net: by-type only engages when at least one room actually has a type —
     otherwise fall back to specific rooms so the page never comes up empty. */
  const byType = () => !!(state.tenant && state.tenant.booking_by_type !== false
    && state.rooms.some((r) => r.room_type_id && state.types[r.room_type_id]));

  /* Promo code can arrive in the link, e.g. book.html?property=you&PROMO=EXTENDED_STAY */
  const urlPromo = (params.get("PROMO") || params.get("promo") || "").trim().toUpperCase();
  if (urlPromo && $("#promoCode")) $("#promoCode").value = urlPromo;

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
      const err = new Error(data.message || data.details || ("Request failed (" + res.status + ")"));
      err.code = data.message || "";
      err.details = data.details || "";
      throw err;
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
    const redirect = safeUrl(state.tenant && state.tenant.booking_redirect_url);
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
    if (byType()) { renderTypeCards(n); return; }
    $("#roomsList").innerHTML = state.rooms.map((r) => {
      const booked = state.available && !state.available.includes(r.id);
      const sel = state.selected && state.selected.id === r.id;
      const type = state.types[r.room_type_id] || null;
      const photos = (r.photos && r.photos.length ? r.photos : (type && type.photos) || []);
      const meta = [`Sleeps ${esc(r.sleeps)}`, esc(r.code)];
      if (type) {
        if (type.bathrooms) meta.push(esc(type.bathrooms) + " bath");
        if (type.view) meta.push(esc(type.view));
        if (type.max_occupants) meta.push("max " + esc(type.max_occupants) + " guests");
        if (type.smoking_policy === "non-smoking") meta.push("Non-smoking");
        if (type.handicap_accessible) meta.push("Accessible");
        if (Array.isArray(type.beds) && type.beds.length) meta.push(type.beds.map((b) => (Number(b.qty) || 1) + "× " + b.type).join(", "));
      }
      const feats = type && Array.isArray(type.features) ? type.features.slice(0, 8) : [];
      const ap = applicablePlan(r, Math.max(1, nights() || 1));
      return `<article class="bk-room${sel ? " sel" : ""}${booked ? " booked" : ""}">
        ${photos.length ? `<img class="bk-room-img" src="${esc(photos[0])}" alt="${esc(r.name)}">` : `<div class="bk-room-ph">${esc((r.name || "R").slice(0, 1))}</div>`}
        <h3>${esc(r.name)}</h3>
        <div class="meta">${meta.join(" · ")}</div>
        ${type && type.description ? `<div class="meta">${esc(type.description)}</div>` : ""}
        ${ap ? `<div class="bk-feats"><span class="bk-feat bk-plan">${esc(ap.plan.name)} · save ${money(ap.saved)}</span></div>` : ""}
        ${feats.length ? `<div class="bk-feats">${feats.map((f) => `<span class="bk-feat">${esc(f)}</span>`).join("")}</div>` : ""}
        <div class="price"><div><b>${money(baseRate(r))}</b> <span>/ night · ${money(nightlyRatesFor(r).reduce((a, b) => a + b, 0) || baseRate(r) * n)} for ${n} night${n > 1 ? "s" : ""}</span></div>
        <button class="bk-select" type="button" data-room="${r.id}" ${booked ? "disabled" : ""}>${booked ? "Booked" : sel ? "Selected ✓" : "Select"}</button></div>
      </article>`;
    }).join("") || `<p class="bk-loading">No rooms are listed yet.</p>`;
    postHeight();
  }
  /* Book-by-type: one card per room type with live availability counts.
     Selecting a type prices from any of its units (identical by construction);
     the exact unit is auto-assigned at submit. */
  function typeGroups() {
    const groups = [], seen = new Map();
    state.rooms.forEach((r) => {
      const t = typeFor(r);
      if (!t) return;
      if (!seen.has(t.id)) { const g = { type: t, units: [] }; seen.set(t.id, g); groups.push(g); }
      seen.get(t.id).units.push(r);
    });
    return groups;
  }
  function renderTypeCards(n) {
    const groups = typeGroups();
    $("#roomsList").innerHTML = groups.map(({ type, units }) => {
      const free = chooseUnits(units, state.available);
      const availKnown = !!state.available;
      const booked = availKnown && free.length === 0;
      const rep = free[0] || units[0];
      const sel = state.selectedTypeId === type.id;
      const photos = (type.photos && type.photos.length ? type.photos : (rep.photos && rep.photos.length ? rep.photos : []));
      const meta = [`Sleeps ${esc(type.max_occupants || rep.sleeps || 2)}`, `${units.length} room${units.length === 1 ? "" : "s"}`];
      if (type.bathrooms) meta.push(esc(type.bathrooms) + " bath");
      if (type.view) meta.push(esc(type.view));
      if (type.smoking_policy === "non-smoking") meta.push("Non-smoking");
      if (type.handicap_accessible) meta.push("Accessible");
      if (Array.isArray(type.beds) && type.beds.length) meta.push(type.beds.map((b) => (Number(b.qty) || 1) + "× " + b.type).join(", "));
      const availNote = !availKnown ? "" : booked ? "Sold out for these dates" : free.length <= 2 ? `Only ${free.length} left` : `${free.length} available`;
      const feats = Array.isArray(type.features) ? type.features.slice(0, 8) : [];
      const ap = applicablePlan(rep, Math.max(1, nights() || 1));
      return `<article class="bk-room${sel ? " sel" : ""}${booked ? " booked" : ""}">
        ${photos.length ? `<img class="bk-room-img" src="${esc(photos[0])}" alt="${esc(type.name)}">` : `<div class="bk-room-ph">${esc((type.name || "R").slice(0, 1))}</div>`}
        <h3>${esc(type.name)}</h3>
        <div class="meta">${meta.join(" · ")}</div>
        ${type.description ? `<div class="meta">${esc(type.description)}</div>` : ""}
        ${availNote ? `<div class="bk-feats"><span class="bk-feat">${esc(availNote)}</span></div>` : ""}
        ${ap ? `<div class="bk-feats"><span class="bk-feat bk-plan">${esc(ap.plan.name)} · save ${money(ap.saved)}</span></div>` : ""}
        ${feats.length ? `<div class="bk-feats">${feats.map((f) => `<span class="bk-feat">${esc(f)}</span>`).join("")}</div>` : ""}
        <div class="price"><div><b>${money(baseRate(rep))}</b> <span>/ night · ${money(nightlyRatesFor(rep).reduce((a, b) => a + b, 0) || baseRate(rep) * n)} for ${n} night${n > 1 ? "s" : ""}</span></div>
        <button class="bk-select" type="button" data-type="${type.id}" ${booked ? "disabled" : ""}>${booked ? "Sold out" : sel ? "Selected ✓" : "Select"}</button></div>
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
  function typeFor(room) { return state.types[room.room_type_id] || null; }
  /* Pricing lives on the room type (hotels price King/Queen/Suite, not units):
     the type's nightly rate wins; the room's stored rate is a legacy fallback. */
  function baseRate(room) {
    const t = typeFor(room);
    return t && t.rack_rate_cents > 0 ? t.rack_rate_cents / 100 : (room.rate_cents || 0) / 100;
  }
  /* Per-date rules from the Rate Calendar: closed nights, CTA/CTD, stay limits. */
  function ruleBlock(room) {
    const n = nights();
    if (!room || !n || n < 1) return null;
    const inIso = $("#inDate").value, outIso = $("#outDate").value;
    const dayRule = (iso) => (room.room_type_id ? state.overrides[room.room_type_id + "|" + iso] : null) || null;
    for (let i = 0; i < n; i++) {
      const d = new Date(inIso + "T12:00:00"); d.setDate(d.getDate() + i);
      const r = dayRule(d.toISOString().slice(0, 10));
      if (r && r.closed) return "This room is closed for part of this stay. Try different dates.";
    }
    const inRule = dayRule(inIso), outRule = dayRule(outIso);
    if (inRule && inRule.cta) return "This room does not accept arrivals on your check-in date.";
    if (outRule && outRule.ctd) return "This room does not accept departures on your check-out date.";
    if (inRule && inRule.minStay && n < inRule.minStay) return `This stay needs at least ${inRule.minStay} nights from that check-in date.`;
    if (inRule && inRule.maxStay && n > inRule.maxStay) return `This stay allows at most ${inRule.maxStay} nights from that check-in date.`;
    return null;
  }
  function daysUntilCheckIn() {
    const t = new Date(); t.setHours(12, 0, 0, 0);
    const d = new Date($("#inDate").value + "T12:00:00");
    return Math.round((d - t) / 864e5);
  }
  /* Best applicable rate plan for this room + stay (standard rate included as a candidate). */
  function applicablePlan(room, n) {
    const type = typeFor(room);
    if (!type || !Array.isArray(type.rate_plans) || !n) return null;
    const code = ($("#promoCode").value || "").trim().toUpperCase();
    const lead = daysUntilCheckIn();
    const base = nightlyRatesFor(room);
    const baseSum = base.reduce((a, b) => a + b, 0);
    let best = null, bestSum = baseSum;
    type.rate_plans.forEach((p) => {
      if (!planApplies(p, { nights: n, leadDays: lead, promoCode: code })) return;
      const adj = applyPlanToRates(base, p);
      const s = adj.reduce((a, b) => a + b, 0);
      if (s < bestSum - 0.001) { bestSum = s; best = { plan: p, rates: adj, saved: Math.round((baseSum - s) * 100) / 100 }; }
    });
    return best;
  }
  function nightlyRatesFor(room) {
    const rates = [];
    const d = new Date($("#inDate").value + "T12:00:00");
    const end = new Date($("#outDate").value + "T12:00:00");
    while (d < end) {
      const iso = d.toISOString().slice(0, 10);
      const over = room.room_type_id ? state.overrides[room.room_type_id + "|" + iso] : null;
      const floor = state.tenant && state.tenant.min_room_rate_cents ? state.tenant.min_room_rate_cents / 100 : 0;
      rates.push(Math.max(floor, over ? over.rate : baseRate(room)));
      d.setDate(d.getDate() + 1);
    }
    return rates;
  }
  /* Deposit: property decides if a booking needs one, and what percent.
     Collected by card when the property finished Stripe Connect and a
     publishable key is configured; otherwise the guest acknowledges it and
     the property collects it (flagged on the reservation). */
  /* Properties with Stripe connected require a card to book online: the
     deposit is charged, or (no deposit) the card is saved, not charged. */
  function cardRequired() {
    const t = state.tenant || {};
    return !!(t.stripe_onboarding_complete && t.stripe_account_id && cfg.STRIPE_PUBLISHABLE_KEY);
  }
  function depositInfo(total) {
    const t = state.tenant || {};
    if (!t.deposit_enabled) return null;
    const pct = Math.min(100, Math.max(1, parseInt(t.deposit_percent, 10) || 25));
    const collectible = !!(t.stripe_onboarding_complete && t.stripe_account_id && cfg.STRIPE_PUBLISHABLE_KEY);
    return { pct, due: round2((total || 0) * pct / 100), collectible };
  }
  async function fnPost(name, body) {
    const res = await fetch(base + "/functions/v1/" + name, {
      method: "POST",
      headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("Payment service failed (" + res.status + ")"));
    return data;
  }
  function loadStripeJs() {
    if (window.Stripe) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3";
      s.onload = resolve; s.onerror = () => reject(new Error("Could not load Stripe"));
      document.head.appendChild(s);
    });
  }
  async function mountCard() {
    if (state.cardEl) return;
    await loadStripeJs();
    // Deposits are destination charges on the platform account (charge-guest),
    // so Stripe.js uses the platform key without a connected-account header.
    state.stripe = window.Stripe(cfg.STRIPE_PUBLISHABLE_KEY);
    const elements = state.stripe.elements();
    state.cardEl = elements.create("card", { style: { base: { fontFamily: "'Public Sans', sans-serif", fontSize: "15px", color: "#101f1e" } } });
    state.cardEl.mount("#cardElement");
  }
  function showSuccess(code, total, extra) {
    document.querySelector(".bk-layout").style.display = "none";
    $("#searchForm").style.display = "none";
    $("#availNote").hidden = true;
    $("#successText").textContent = "Thanks " + $("#gName").value.trim().split(" ")[0] + " — " + state.tenant.name + " will confirm your " + state.selected.name + " stay by email shortly." + (state.tenant.check_out_time ? " Check-out is by " + state.tenant.check_out_time + "." : "") + (extra || "");
    $("#successCode").textContent = "Confirmation " + code + " · Total " + money(total);
    const panel = $("#successPanel");
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    trackConversion(code, total);
    postHeight();
  }
  function showPaidThanks() {
    document.querySelector(".bk-layout").style.display = "none";
    $("#searchForm").style.display = "none";
    $("#successPanel h2").textContent = "Payment received";
    $("#successText").textContent = "Thank you — " + state.tenant.name + " has received your payment. Stripe emails your receipt, and the property has your updated balance.";
    $("#successCode").textContent = "Booking " + paidRef;
    $("#successPanel").hidden = false;
    postHeight();
  }
  /* After the booking is saved: open the secure card form for the deposit,
     or (no deposit) to save the card. Runs again on retry, on the same
     booking, so a failure here can never book a second room. */
  async function startCardStep() {
    const b = state.booked;
    const btn = $("#bookBtn"), pErr = $("#payError");
    const deposit = b.depositCents > 0;
    pErr.hidden = true;
    btn.disabled = true; btn.textContent = "Opening secure card form…";
    try {
      const r = await fnPost("charge-guest", deposit
        ? { tenant_id: state.tenant.id, reservation_id: b.resId }
        : { action: "setup", tenant_id: state.tenant.id, reservation_id: b.resId });
      if (!r.client_secret) throw new Error("no client secret");
      const due = deposit ? (r.amount_cents || b.depositCents) / 100 : 0;
      state.paying = { mode: deposit ? "deposit" : "setup", clientSecret: r.client_secret, due };
      $("#payTitle").textContent = deposit ? "Deposit payment" : "Card to hold your booking";
      $("#payText").textContent = deposit
        ? `A deposit of ${money(due)} (${b.depositPct}% of ${money(b.total)}) is due today to confirm ${state.selected.name}. The balance is due at the property.`
        : `${state.tenant.name} requires a card to hold your ${state.selected.name} booking. Nothing is charged now — Stripe keeps the card securely for your balance and the cancellation policy.`;
      $("#payPanel").hidden = false;
      await mountCard();
      btn.disabled = false;
      btn.textContent = deposit ? "Pay " + money(due) + " deposit" : "Save card & confirm booking";
      $("#payPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      pErr.textContent = "We couldn't open the secure card form. Please try again — your room is held for 30 minutes.";
      pErr.hidden = false;
      $("#payPanel").hidden = false;
      btn.disabled = false;
      btn.textContent = "Try the card form again";
    }
    postHeight();
  }
  async function payDeposit() {
    const btn = $("#bookBtn");
    const pErr = $("#payError");
    const b = state.booked, pay = state.paying;
    const billing = { name: $("#gName").value.trim(), email: $("#gEmail").value.trim() };
    pErr.hidden = true;
    btn.disabled = true; btn.textContent = "Processing…";
    try {
      if (pay.mode === "setup") {
        const { setupIntent, error } = await state.stripe.confirmCardSetup(pay.clientSecret, { payment_method: { card: state.cardEl, billing_details: billing } });
        if (error) throw new Error(error.message || "Card declined");
        if (!setupIntent || setupIntent.status !== "succeeded") throw new Error("The card could not be saved. Please try another card.");
        await fnPost("charge-guest", { action: "confirm_setup", tenant_id: state.tenant.id, setup_intent_id: setupIntent.id }).catch(() => {});
        fnPost("send-email", { action: "booking_confirmation", reservation_id: b.resId }).catch(() => {});
        showSuccess(b.code, b.total, " Your card is saved to hold the booking — nothing has been charged.");
        return;
      }
      const { paymentIntent, error } = await state.stripe.confirmCardPayment(pay.clientSecret, { payment_method: { card: state.cardEl, billing_details: billing } });
      if (error) throw new Error(error.message || "Card declined");
      if (!paymentIntent || paymentIntent.status !== "succeeded") throw new Error("Payment did not complete. Please try another card.");
      await fnPost("charge-guest", { action: "confirm", tenant_id: state.tenant.id, payment_intent_id: paymentIntent.id }).catch(() => {});
      fnPost("send-email", { action: "booking_confirmation", reservation_id: b.resId }).catch(() => {});
      fnPost("send-email", { action: "charge_receipt", reservation_id: b.resId, payment_intent_id: paymentIntent.id }).catch(() => {});
      showSuccess(b.code, b.total, ` Your ${money(pay.due)} deposit is paid — the remaining balance is due at the property.`);
    } catch (e) {
      pErr.textContent = e.message || "Payment failed. Please check the card and try again.";
      pErr.hidden = false;
      btn.disabled = false;
      btn.textContent = pay.mode === "setup" ? "Save card & confirm booking" : "Pay " + money(pay.due) + " deposit";
      postHeight();
    }
  }

  function cancellationText(t) {
    if (!t) return "";
    if (t.cancellation_policy === "custom") return (t.cancellation_policy_text || "").trim();
    return {
      flexible: "Flexible cancellation: full refund if you cancel at least 48 hours before check-in.",
      moderate: "Moderate cancellation: full refund if you cancel at least 7 days before check-in.",
      strict: "Strict cancellation: 50% refund if you cancel at least 14 days before check-in."
    }[t.cancellation_policy] || "";
  }
  function termsRequired() {
    const wrap = $("#termsAckWrap");
    return !!(wrap && !wrap.hidden);
  }
  function renderTerms() {
    const t = state.tenant;
    if (!t) return;
    const rawTerms = (t.rental_terms || "").trim();
    const lines = rawTerms.split(/\r?\n/).map((line) => line.trim().replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "")).filter(Boolean);
    const policy = cancellationText(t);
    const hasTimes = !!(t.check_in_time || t.check_out_time);
    const section = $("#termsSection");
    section.hidden = !(lines.length || policy || hasTimes);
    if (section.hidden) return;
    const times = [];
    if (t.check_in_time) times.push(`<span>Check-in: ${esc(t.check_in_time)}</span>`);
    if (t.check_out_time) times.push(`<span>Check-out: ${esc(t.check_out_time)}</span>`);
    $("#termsTimes").innerHTML = times.join("");
    const policyEl = $("#termsCancellation");
    policyEl.textContent = policy;
    policyEl.hidden = !policy;
    $("#termsTitle").hidden = !lines.length;
    $("#termsList").innerHTML = lines.map((line) => `<li>${esc(line)}</li>`).join("");
    $("#termsAckWrap").hidden = !lines.length;
    const note = $("#summaryPolicyNote");
    if (note) note.textContent = policy || "No payment taken now unless the property requires a deposit.";
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
    const type = typeFor(state.selected);
    if (type && type.min_stay && n < type.min_stay) {
      $("#summaryBody").innerHTML = `<p class="bk-muted">This room type needs at least ${type.min_stay} night${type.min_stay > 1 ? "s" : ""}. Add a night or pick another room.</p>`;
      btn.disabled = true; btn.textContent = `Minimum stay ${type.min_stay} nights`;
      return null;
    }
    if (type && type.max_stay && n > type.max_stay) {
      $("#summaryBody").innerHTML = `<p class="bk-muted">This room type allows at most ${type.max_stay} nights online. Contact the property for a longer stay.</p>`;
      btn.disabled = true; btn.textContent = `Maximum stay ${type.max_stay} nights`;
      return null;
    }
    const rb = ruleBlock(state.selected);
    if (rb) {
      $("#summaryBody").innerHTML = `<p class="bk-muted">${esc(rb)}</p>`;
      btn.disabled = true; btn.textContent = "Not available for these dates";
      return null;
    }
    const guests = Math.max(1, parseInt($("#guests").value) || 1);
    const occupantCaps = [state.tenant && state.tenant.maximum_total_occupants, type && type.max_occupants]
      .map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
    const occupantCap = occupantCaps.length ? Math.min(...occupantCaps) : null;
    if (occupantCap && guests > occupantCap) {
      $("#summaryBody").innerHTML = `<p class="bk-muted">This booking allows at most ${occupantCap} total occupant${occupantCap > 1 ? "s" : ""}. Reduce the guest count or contact the property for a larger group.</p>`;
      btn.disabled = true; btn.textContent = `Maximum ${occupantCap} occupants`;
      return null;
    }
    const ap = applicablePlan(state.selected, n);
    const included = ap && ap.plan.includedOccupants != null ? ap.plan.includedOccupants
      : type && type.included_adults != null ? type.included_adults
      : state.tenant && state.tenant.included_occupants != null ? state.tenant.included_occupants : 2;
    const extraGuests = Math.max(0, guests - included);
    const extraRate = ap && ap.plan.extraAdultRate ? ap.plan.extraAdultRate : (type && type.extra_adult_cents ? type.extra_adult_cents / 100 : 0);
    const addonPayload = chosenAddons().map((a) => ({ name: a.name, price: a.price_cents / 100, per: a.per, qty: 1 }));
    if (extraGuests > 0 && extraRate > 0) addonPayload.push({ name: `Extra guests × ${extraGuests}`, price: extraRate, per: "night", qty: 1 });
    const q = quote({ rate: baseRate(state.selected), nights: n, guests, nightlyRates: ap ? ap.rates : nightlyRatesFor(state.selected), addons: addonPayload, taxes: state.taxes });
    const code = ($("#promoCode").value || "").trim().toUpperCase();
    const dep = depositInfo(q.total);
    state.dep = dep;
    const ackWrap = $("#depAckWrap");
    const needsAck = !!(dep && !dep.collectible);
    if (needsAck) {
      ackWrap.hidden = false;
      $("#depAckText").textContent = `I understand a deposit of ${money(dep.due)} (${dep.pct}% of the total) is required to confirm this booking. The property will arrange collection.`;
    } else ackWrap.hidden = true;
    $("#summaryBody").innerHTML =
      `<div class="bk-line"><span>${esc(byType() && type ? type.name : state.selected.name)} × ${n} night${n > 1 ? "s" : ""}${byType() ? " · room assigned on confirmation" : ""}</span><b>${money(q.subtotal)}</b></div>` +
      (ap ? `<div class="bk-line"><span>${esc(ap.plan.name)} applied</span><b>−${money(ap.saved)}</b></div>` : "") +
      (!ap && code ? `<div class="bk-line"><span>Code ${esc(code)} didn't apply to this room or stay length</span><b></b></div>` : "") +
      q.addonLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      q.taxLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      `<div class="bk-line total"><span>Total</span><b>${money(q.total)}</b></div>` +
      (dep ? `<div class="bk-line"><span>Deposit due today (${dep.pct}%)</span><b>${money(dep.due)}</b></div><div class="bk-line"><span>Balance at the property</span><b>${money(round2(q.total - dep.due))}</b></div>`
        : cardRequired() ? `<div class="bk-line"><span>Due today · card required to hold</span><b>${money(0)}</b></div>` : "");
    if (state.paying) { btn.disabled = false; btn.textContent = state.paying.mode === "setup" ? "Save card & confirm booking" : "Pay " + money(state.paying.due) + " deposit"; }
    else if (state.booked) { btn.disabled = false; btn.textContent = "Try the card form again"; }
    else if (termsRequired() && !$("#gTermsAck").checked) { btn.disabled = true; btn.textContent = "Agree to the property terms to continue"; }
    else if (needsAck && !$("#depAck").checked) { btn.disabled = true; btn.textContent = "Tick the deposit box to continue"; }
    else {
      btn.disabled = false;
      btn.textContent = dep && dep.collectible ? "Book & pay " + money(dep.due) + " deposit"
        : cardRequired() && !dep ? "Book · add card to hold" : "Request booking · " + money(q.total);
    }
    postHeight();
    return q;
  }

  async function checkAvailability() {
    try {
      const rows = await api("rpc/get_available_room_ids", {
        method: "POST",
        body: JSON.stringify({ p_tenant: state.tenant.id, p_check_in: $("#inDate").value, p_check_out: $("#outDate").value })
      });
      state.available = (rows || []).map((r) => (typeof r === "string" ? r : r.get_available_room_ids))
        .filter((id) => { const room = state.rooms.find((x) => x.id === id); return room && !ruleBlock(room); });
      $("#availNote").hidden = false;
      $("#availNote").textContent = byType()
        ? typeGroups().filter((g) => chooseUnits(g.units, state.available).length).length + " room types available for these dates — we assign your exact room when you book."
        : state.available.length + " of " + state.rooms.length + " rooms available for these dates.";
    } catch {
      state.available = null; // availability function not installed yet: constraint still protects at submit
      $("#availNote").hidden = false;
      $("#availNote").textContent = "Showing all rooms — the property confirms availability with your request.";
    }
    if (state.available) {
      if (byType() && state.selectedTypeId) {
        const units = state.rooms.filter((r) => r.room_type_id === state.selectedTypeId);
        const free = chooseUnits(units, state.available);
        if (free.length) state.selected = free[0];
        else { state.selected = null; state.selectedTypeId = null; }
      } else if (state.selected && !state.available.includes(state.selected.id)) state.selected = null;
    }
    renderRooms(); renderSummary();
  }

  const TYPE_COLS = "id,name,description,bathrooms,view,smoking_policy,min_stay,max_stay,rack_rate_cents,extra_adult_cents,included_adults,max_occupants,beds,handicap_accessible,accessible_features,features,photos";
  /* Guest-visible rate plans: plans without a code plus any matching the code
     typed here. get_rate_plans never returns other promo codes. */
  async function loadRatePlans() {
    if (!state.tenant) return;
    const promo = ($("#promoCode").value || "").trim().toUpperCase();
    const rows = await api("rpc/get_rate_plans", {
      method: "POST",
      body: JSON.stringify({ p_tenant: state.tenant.id, p_promo: promo || null })
    }).catch(() => null);
    if (!rows) return;
    Object.values(state.types).forEach((t) => { t.rate_plans = []; });
    rows.forEach((row) => {
      if (state.types[row.room_type_id]) state.types[row.room_type_id].rate_plans = Array.isArray(row.rate_plans) ? row.rate_plans : [];
    });
  }

  async function load() {
    if (!base || !anon) { showError("Booking is not configured yet. Please contact the property directly."); return; }
    try {
      // Public booking profile only — never select=*: tenants also hold
      // secrets (ical_token, Stripe customer ids, private notification
      // emails) that the anon key must not be able to read (see the
      // 20261112000000_demo_lockdown migration).
      const tenantCols = "id,name,slug,contact_email,phone,logo_url,brand_color,booking_bg_color,booking_fg_color,hero_image_url,hero_focus_x,hero_focus_y,booking_headline,booking_subheading,description,address_line1,address_line2,postcode,city,state,country,website_url,facebook_url,instagram_url,twitter_url,youtube_url,star_rated,star_count,gdpr_consent,check_in_time,check_out_time,cancellation_policy,cancellation_policy_text,rental_terms,currency,stripe_account_id,stripe_onboarding_complete,ga_measurement_id,booking_redirect_url,deposit_enabled,deposit_percent,booking_by_type,included_occupants,maximum_total_occupants,min_room_rate_cents";
      const tenants = await api("tenants?slug=eq." + encodeURIComponent(slug) + "&select=" + tenantCols);
      state.tenant = tenants && tenants[0];
      if (!state.tenant) { showError("We could not find this property. Check the link and try again."); return; }
      const t = state.tenant;
      document.title = "Book · " + t.name;
      $("#propName").textContent = t.name;
      $("#propMark").textContent = (t.name || "S").slice(0, 1).toUpperCase();
      $("#propHeadline").textContent = t.booking_headline || ("Stay at " + t.name);
      $("#propSub").textContent = t.booking_subheading || t.description || "";
      {
        // Property details from Settings (About / contact / socials / GDPR).
        const addr = [t.address_line1, t.address_line2, [t.city, t.state].filter(Boolean).join(", "), t.postcode, t.country].filter(Boolean).join(" · ");
        const contact = [];
        if (addr) contact.push(`<span>${esc(addr)}</span>`);
        if (t.phone) contact.push(`<span>${esc(t.phone)}</span>`);
        if (t.contact_email) contact.push(`<span>${esc(t.contact_email)}</span>`);
        if (safeUrl(t.website_url)) contact.push(`<a href="${esc(safeUrl(t.website_url))}" target="_blank" rel="noopener">Property website</a>`);
        const socials = [["Facebook", t.facebook_url], ["Instagram", t.instagram_url], ["Twitter / X", t.twitter_url], ["YouTube", t.youtube_url]]
          .map(([label, u]) => [label, safeUrl(u)])
          .filter(([, u]) => u).map(([label, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`).join("");
        const hasAbout = !!(t.description || contact.length || socials);
        $("#propAbout").hidden = !hasAbout;
        if (hasAbout) {
          $("#aboutTitle").textContent = "About " + t.name;
          $("#aboutDesc").textContent = t.description || "";
          $("#aboutContact").innerHTML = contact.map((c) => c.startsWith("<a") ? c : c).join("");
          $("#aboutSocials").innerHTML = socials;
          if (t.star_rated && t.star_count) {
            const st = $("#aboutStars");
            st.hidden = false;
            st.textContent = "★".repeat(Math.min(5, t.star_count)) + " rated property";
          }
        }
        if (t.gdpr_consent) $("#gConsentWrap").hidden = false;
      }
      if (t.brand_color) {
        document.documentElement.style.setProperty("--brand", t.brand_color);
        document.documentElement.style.setProperty("--brand-2", t.brand_color);
      }
      // Owner-picked page colors (validated hex; anything else is ignored).
      const hexColor = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : "");
      if (hexColor(t.booking_bg_color)) document.documentElement.style.setProperty("--bg", t.booking_bg_color);
      if (hexColor(t.booking_fg_color)) {
        document.documentElement.style.setProperty("--ink", t.booking_fg_color);
        document.documentElement.style.setProperty("--ink-2", t.booking_fg_color);
      }
      const heroUrl = safeUrl(t.hero_image_url, { httpsOnly: true });
      if (heroUrl) {
        const heroEl = $("#bkHero");
        if (heroEl) {
          heroEl.classList.add("has-hero");
          heroEl.style.backgroundImage = `linear-gradient(180deg, rgb(8 20 20 / 38%), rgb(8 20 20 / 60%)), url("${heroUrl.replace(/["\\]/g, encodeURIComponent)}")`;
          const pct = (v, d) => (v == null || isNaN(Number(v)) ? d : Math.min(100, Math.max(0, Number(v))));
          heroEl.style.backgroundPosition = `${pct(t.hero_focus_x, 50)}% ${pct(t.hero_focus_y, 50)}%`;
        }
      }
      if (t.logo_url) {
        const mk = $("#propMark");
        mk.innerHTML = `<img src="${esc(t.logo_url)}" alt="">`;
        mk.style.background = "none";
      }
      setupGA();
      const tid = "tenant_id=eq." + t.id;
      const overrideRows = await api("room_rate_overrides?" + tid + "&select=room_type_id,date,rate_cents,min_stay,max_stay,closed,cta,ctd").catch(() => []);
      state.overrides = {};
      (overrideRows || []).forEach((o) => {
        state.overrides[o.room_type_id + "|" + String(o.date).slice(0, 10)] = {
          rate: (o.rate_cents || 0) / 100,
          minStay: o.min_stay != null ? o.min_stay : null, maxStay: o.max_stay != null ? o.max_stay : null,
          closed: !!o.closed, cta: !!o.cta, ctd: !!o.ctd
        };
      });
      const [rooms, addons, taxes, typeRows] = await Promise.all([
        api("rooms?" + tid + "&select=id,tenant_id,room_type_id,code,name,sleeps,rate_cents,weekend_rate_cents,photos,sort_order&order=sort_order.asc"),
        api("addons?" + tid + "&active=eq.true&select=*&order=name.asc"),
        api("tax_rules?" + tid + "&active=eq.true&select=*&order=sort_order.asc"),
        // Never select=* or rate_plans: anon cannot read promo codes (see
        // 20261115000100_public_booking_lockdown); plans come from loadRatePlans().
        api("room_types?" + tid + "&select=" + TYPE_COLS + "&order=name.asc").catch(() => [])
      ]);
      state.types = {};
      (typeRows || []).forEach((t) => { state.types[t.id] = t; });
      state.rooms = rooms || [];
      state.addons = addons || [];
      state.taxes = (taxes || []).map((x) => ({ name: x.name, kind: x.kind, value: Number(x.rate), applies: x.applies_to }));
      await loadRatePlans();
      renderTerms();
      renderRooms(); renderAddons(); renderSummary(); postHeight();
      if (paidRef) showPaidThanks();
    } catch (e) {
      showError("Booking is temporarily unavailable. Please contact the property directly.");
    }
  }

  /* Defaults: a week out, two nights. */
  const d = (off) => { const x = new Date(Date.now() + off * 864e5); return x.toISOString().slice(0, 10); };
  $("#inDate").value = d(7);
  $("#outDate").value = d(9);

  $("#roomsList").addEventListener("click", (e) => {
    const tb = e.target.closest("[data-type]");
    if (tb && !tb.disabled) {
      state.selectedTypeId = tb.dataset.type;
      const units = state.rooms.filter((r) => r.room_type_id === state.selectedTypeId);
      state.selected = chooseUnits(units, state.available)[0] || units[0] || null;
      renderRooms(); renderSummary();
      return;
    }
    const b = e.target.closest("[data-room]");
    if (!b || b.disabled) return;
    state.selectedTypeId = null;
    state.selected = state.rooms.find((r) => r.id === b.dataset.room) || null;
    renderRooms(); renderSummary();
  });
  function syncDateMins() {
    const todayIso = d(0);
    $("#inDate").min = todayIso;
    if ($("#inDate").value) {
      const nx = new Date($("#inDate").value + "T12:00:00"); nx.setDate(nx.getDate() + 1);
      $("#outDate").min = nx.toISOString().slice(0, 10);
    }
  }
  syncDateMins();
  ["inDate", "outDate"].forEach((id) => $("#" + id).addEventListener("change", () => {
    syncDateMins();
    if (state.tenant) checkAvailability(); else { renderRooms(); renderSummary(); }
  }));
  $("#guests").addEventListener("change", () => { renderRooms(); renderSummary(); });
  $("#promoCode").addEventListener("change", async () => { await loadRatePlans(); renderRooms(); renderSummary(); });
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); showError(""); checkAvailability(); });

  $("#depAck").addEventListener("change", () => renderSummary());
  $("#gTermsAck").addEventListener("change", () => renderSummary());
  $("#bookBtn").addEventListener("click", async () => {
    if (state.paying) { await payDeposit(); return; }
    if (state.booked) { await startCardStep(); return; }
    showError("");
    const name = $("#gName").value.trim();
    const email = $("#gEmail").value.trim();
    if (!state.selected) { showError("Please select a room first."); return; }
    if (!name || !email) { showError("Please add your name and email so the property can confirm."); $("#gName").focus(); return; }
    if (termsRequired() && !$("#gTermsAck").checked) { showError("Please read and agree to the property's terms and house rules before booking."); $("#gTermsAck").focus(); return; }
    const q = renderSummary();
    if (!q) { showError("Please fix your dates."); return; }
    const btn = $("#bookBtn");
    btn.disabled = true; btn.textContent = "Sending…";
    const selAddons = chosenAddons();
    const consentEl = $("#gConsent");
    try {
      /* The server prices the stay from the property's own rates, assigns a
         free unit (by type: first free one; two guests racing for the last
         unit can't both win), generates the confirmation code and stores
         the request. The quote shown above is only a preview. */
      const booked = await api("rpc/create_booking", {
        method: "POST",
        body: JSON.stringify({
          p_tenant: state.tenant.id,
          p_room: byType() && state.selectedTypeId ? null : state.selected.id,
          p_room_type: byType() && state.selectedTypeId ? state.selectedTypeId : null,
          p_check_in: $("#inDate").value, p_check_out: $("#outDate").value,
          p_guests: Math.max(1, parseInt($("#guests").value) || 1),
          p_name: name, p_email: email, p_phone: $("#gPhone").value.trim() || null,
          p_requests: $("#gNotes").value.trim() || null,
          p_addon_ids: selAddons.map((a) => a.id),
          p_promo: ($("#promoCode").value || "").trim().toUpperCase() || null,
          p_marketing_consent: !!(consentEl && !$("#gConsentWrap").hidden && consentEl.checked),
          p_terms_accepted: termsRequired() && $("#gTermsAck").checked
        })
      });
      const resId = booked.reservation_id, code = booked.confirmation_code;
      const total = (booked.total_cents || 0) / 100;
      state.selected = state.rooms.find((r) => r.id === booked.room_id) || state.selected;
      state.booked = { resId, code, total, depositCents: booked.deposit_cents || 0, depositPct: booked.deposit_percent };
      if (booked.card_required && cfg.STRIPE_PUBLISHABLE_KEY) {
        // Card required (deposit or guarantee): the confirmation email goes out
        // once the card is in; bookings without one are released after 30 minutes.
        await startCardStep();
        return;
      }
      // Guest confirmation email (+ property notification). Best effort: the booking already succeeded.
      fnPost("send-email", { action: "booking_confirmation", reservation_id: resId }).catch(() => {});
      showSuccess(code, total, booked.deposit_cents > 0 ? ` A deposit of ${money(booked.deposit_cents / 100)} (${booked.deposit_percent}%) is required to confirm — the property will arrange collection.` : "");
    } catch (e) {
      btn.disabled = false; btn.textContent = "Request booking";
      showError(bookingErrorText(e));
      if (e && e.code === "unavailable" && state.tenant) checkAvailability().catch(() => {});
    }
  });

  load();
})();
