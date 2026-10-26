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
  window.SHBookCalc = { quote, applyPlanToRates, planApplies };

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

  const state = { tenant: null, rooms: [], types: {}, addons: [], taxes: [], selected: null, available: null, gaId: "", overrides: {}, dep: null, paying: null, stripe: null, cardEl: null };

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
    state.stripe = window.Stripe(cfg.STRIPE_PUBLISHABLE_KEY, { stripeAccount: state.tenant.stripe_account_id });
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
  async function payDeposit() {
    const btn = $("#bookBtn");
    const pErr = $("#payError");
    pErr.hidden = true;
    btn.disabled = true; btn.textContent = "Processing…";
    try {
      const { paymentIntent, error } = await state.stripe.confirmCardPayment(state.paying.clientSecret, {
        payment_method: { card: state.cardEl, billing_details: { name: $("#gName").value.trim(), email: $("#gEmail").value.trim() } }
      });
      if (error) throw new Error(error.message || "Card declined");
      if (!paymentIntent || paymentIntent.status !== "succeeded") throw new Error("Payment did not complete. Please try another card.");
      await fnPost("charge-guest", { action: "confirm", tenant_id: state.tenant.id, payment_intent_id: paymentIntent.id }).catch(() => {});
      fnPost("send-email", { action: "charge_receipt", reservation_id: state.paying.resId, payment_intent_id: paymentIntent.id }).catch(() => {});
      const { code, total, due } = state.paying;
      showSuccess(code, total, ` Your ${money(due)} deposit is paid — the remaining balance is due at the property.`);
    } catch (e) {
      pErr.textContent = e.message || "Payment failed. Please check the card and try again.";
      pErr.hidden = false;
      btn.disabled = false;
      btn.textContent = "Pay " + money(state.paying.due) + " deposit";
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
      `<div class="bk-line"><span>${esc(state.selected.name)} × ${n} night${n > 1 ? "s" : ""}</span><b>${money(q.subtotal)}</b></div>` +
      (ap ? `<div class="bk-line"><span>${esc(ap.plan.name)} applied</span><b>−${money(ap.saved)}</b></div>` : "") +
      (!ap && code ? `<div class="bk-line"><span>Code ${esc(code)} didn't apply to this room or stay length</span><b></b></div>` : "") +
      q.addonLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      q.taxLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      `<div class="bk-line total"><span>Total</span><b>${money(q.total)}</b></div>` +
      (dep ? `<div class="bk-line"><span>Deposit due today (${dep.pct}%)</span><b>${money(dep.due)}</b></div><div class="bk-line"><span>Balance at the property</span><b>${money(round2(q.total - dep.due))}</b></div>` : "");
    if (state.paying) { btn.disabled = false; btn.textContent = "Pay " + money(state.paying.due) + " deposit"; }
    else if (termsRequired() && !$("#gTermsAck").checked) { btn.disabled = true; btn.textContent = "Agree to the property terms to continue"; }
    else if (needsAck && !$("#depAck").checked) { btn.disabled = true; btn.textContent = "Tick the deposit box to continue"; }
    else {
      btn.disabled = false;
      btn.textContent = dep && dep.collectible ? "Book & pay " + money(dep.due) + " deposit" : "Request booking · " + money(q.total);
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
      $("#propSub").textContent = t.booking_subheading || t.description || "";
      {
        // Property details from Settings (About / contact / socials / GDPR).
        const addr = [t.address_line1, t.address_line2, [t.city, t.state].filter(Boolean).join(", "), t.postcode, t.country].filter(Boolean).join(" · ");
        const contact = [];
        if (addr) contact.push(`<span>${esc(addr)}</span>`);
        if (t.phone) contact.push(`<span>${esc(t.phone)}</span>`);
        if (t.contact_email) contact.push(`<span>${esc(t.contact_email)}</span>`);
        if (t.website_url) contact.push(`<a href="${esc(t.website_url)}" target="_blank" rel="noopener">Property website</a>`);
        const socials = [["Facebook", t.facebook_url], ["Instagram", t.instagram_url], ["Twitter / X", t.twitter_url], ["YouTube", t.youtube_url]]
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
        api("rooms?" + tid + "&select=*&order=sort_order.asc"),
        api("addons?" + tid + "&active=eq.true&select=*&order=name.asc"),
        api("tax_rules?" + tid + "&active=eq.true&select=*&order=sort_order.asc"),
        api("room_types?" + tid + "&select=*&order=name.asc").catch(() => [])
      ]);
      state.types = {};
      (typeRows || []).forEach((t) => { state.types[t.id] = t; });
      state.rooms = rooms || [];
      state.addons = addons || [];
      state.taxes = (taxes || []).map((x) => ({ name: x.name, kind: x.kind, value: Number(x.rate), applies: x.applies_to }));
      renderTerms();
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
  ["guests", "promoCode"].forEach((id) => $("#" + id).addEventListener("change", () => { renderRooms(); renderSummary(); }));
  $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); showError(""); checkAvailability(); });

  $("#depAck").addEventListener("change", () => renderSummary());
  $("#gTermsAck").addEventListener("change", () => renderSummary());
  $("#bookBtn").addEventListener("click", async () => {
    if (state.paying) { await payDeposit(); return; }
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
    const code = "SH-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const resId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + "-" + Math.random().toString(36).slice(2));
    const selAddons = chosenAddons();
    const apNow = applicablePlan(state.selected, nights());
    const consentEl = $("#gConsent");
    const notes = [$("#gNotes").value.trim(), selAddons.length ? "Add-ons: " + selAddons.map((a) => a.name).join(", ") : "",
      apNow ? "Rate plan: " + apNow.plan.name : "",
      ($("#promoCode").value || "").trim() ? "Promo code: " + $("#promoCode").value.trim().toUpperCase() : "",
      consentEl && !$("#gConsentWrap").hidden && consentEl.checked ? "Marketing consent: yes" : "",
      termsRequired() ? "Guest agreed to property terms & house rules" : "",
    state.dep ? `Deposit ${state.dep.collectible ? "to pay by card" : "acknowledged, to be collected by property"}: ${money(state.dep.due)} (${state.dep.pct}%)` : ""].filter(Boolean).join(" · ");
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
      // Guest confirmation email (+ property notification). Best effort: the booking already succeeded.
      fnPost("send-email", { action: "booking_confirmation", reservation_id: resId }).catch(() => {});
      if (state.dep && state.dep.collectible) {
        // Deposit required: create the card charge and switch the button to Pay.
        btn.textContent = "Preparing secure payment…";
        const pi = await fnPost("charge-guest", {
          tenant_id: state.tenant.id, reservation_id: resId,
          amount_cents: Math.round(state.dep.due * 100),
          description: "Booking deposit · " + code + " · " + state.selected.name
        });
        state.paying = { resId, code, total: q.total, due: state.dep.due, clientSecret: pi.client_secret };
        $("#payText").textContent = `A deposit of ${money(state.dep.due)} (${state.dep.pct}% of ${money(q.total)}) is due today to confirm ${state.selected.name}. The balance is due at the property.`;
        $("#payPanel").hidden = false;
        await mountCard();
        btn.disabled = false;
        btn.textContent = "Pay " + money(state.dep.due) + " deposit";
        $("#payPanel").scrollIntoView({ behavior: "smooth", block: "center" });
        postHeight();
        return;
      }
      showSuccess(code, q.total, state.dep ? ` A deposit of ${money(state.dep.due)} (${state.dep.pct}%) is required to confirm — the property will arrange collection.` : "");
    } catch (e) {
      btn.disabled = false; btn.textContent = "Request booking";
      showError(/exclusion|conflict|duplicate|409/i.test(e.message)
        ? "Those dates just became unavailable for this room. Try different dates or another room."
        : "Something went wrong sending your request. Please try again or contact the property.");
    }
  });

  load();
})();
