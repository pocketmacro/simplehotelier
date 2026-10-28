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
  /* Extra-guest charge per night — mirrors quote_stay (20261125000000).
     Included places go to adults first, then children. Each extra adult pays
     the adult rate; each extra child the child rate (the adult rate when none
     is set); infants pay only when an infant rate is set. */
  function occupancyCharge({ adults, children = 0, infants = 0, included = 2, includedChildren = 0, includedInfants = 0,
    adultRate = 0, childRate = 0, infantRate = 0 }) {
    const extraAdults = Math.max(0, adults - included);
    const extraChildren = Math.max(0, children - (Math.max(0, included - adults) + Math.max(0, includedChildren)));
    const extraInfants = Math.max(0, infants - Math.max(0, includedInfants));
    const cRate = childRate > 0 ? childRate : adultRate, iRate = infantRate > 0 ? infantRate : 0;
    return {
      perNight: round2(extraAdults * adultRate + extraChildren * cRate + extraInfants * iRate),
      count: extraAdults + extraChildren + (iRate > 0 ? extraInfants : 0)
    };
  }
  /* The first adult/child/infant limit a party breaks (room type and
     property; 0 = no limit), or "". Mirrors quote_stay. */
  function partyProblem(party, type, tenant) {
    const lim = (a, b) => { const v = [a, b].map(Number).filter((x) => x > 0); return v.length ? Math.min(...v) : 0; };
    const need = Math.max(1, Number(type && type.adults_required) || 1);
    if (party.adults < need) return `Needs at least ${need} adults`;
    const a = lim(type && type.max_adults, tenant && tenant.maximum_adults);
    const c = lim(type && type.max_children, tenant && tenant.maximum_children);
    const i = lim(type && type.max_infants, tenant && tenant.maximum_infants);
    if (a && party.adults > a) return `Up to ${a} adult${a === 1 ? "" : "s"}`;
    if (c && party.children > c) return `Up to ${c} ${c === 1 ? "child" : "children"}`;
    if (i && party.infants > i) return `Up to ${i} infant${i === 1 ? "" : "s"}`;
    return "";
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
  window.SHBookCalc = { quote, applyPlanToRates, planApplies, chooseUnits, safeUrl, bookingErrorText, occupancyCharge, partyProblem };

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
  /* Booking Page studio preview (dashboard iframe): unsaved theme/content
     edits arrive by postMessage from the dashboard's own origin; booking is off. */
  const isPreview = params.get("preview") === "1";
  /* Guests land here from a payment-request link once Stripe has the payment. */
  const paidRef = (params.get("paid") || "").trim().slice(0, 40);
  if (isEmbed) document.body.classList.add("embed");

  const $ = (s) => document.querySelector(s);
  /* Money in the property's currency (js/money.js). Card prices drop ".00"
     ($295, $14.50); totals keep cents. */
  const currency = () => (state.tenant && state.tenant.currency) || "USD";
  const money = (n) => SHMoney.format(n, currency());
  const price = (n) => SHMoney.format(n, currency(), { short: true });
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
      const payload = { transaction_id: code, value: total, currency: currency() };
      window.gtag("event", "purchase", payload);        // GA4 recommended commerce event
      window.gtag("event", "booking_complete", payload); // explicit custom conversion
    }
    const redirect = safeUrl(state.tenant && state.tenant.booking_redirect_url);
    if (redirect) {
      try {
        const u = new URL(redirect);
        u.searchParams.set("booking_ref", code);
        u.searchParams.set("total", total);
        u.searchParams.set("currency", currency());
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

  const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
  const HOUSE_SVG = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>`;
  /* Who's coming. Adults + children count toward occupancy; infants don't.
     The three are asked for separately only when the property's rooms price
     or limit them (otherwise one guest counter, all adults). */
  const party = { adults: 2, children: 0, infants: 0 };
  const guestsCount = () => party.adults + party.children;
  const PARTY_KEYS = ["extra_child_cents", "extra_infant_cents", "included_children", "included_infants", "max_adults", "max_children", "max_infants"];
  function splitParty() {
    const t = state.tenant || {};
    if ([t.maximum_adults, t.maximum_children, t.maximum_infants].some((v) => Number(v) > 0)) return true;
    return Object.values(state.types).some((ty) => PARTY_KEYS.some((k) => Number(ty[k]) > 0) || Number(ty.adults_required) > 1
      || (ty.rate_plans || []).some((p) => Number(p.extraChildRate) > 0 || Number(p.extraInfantRate) > 0));
  }
  const partyText = () => [plural(party.adults, "adult", "adults"),
    party.children ? plural(party.children, "child", "children") : "", party.infants ? plural(party.infants, "infant", "infants") : ""]
    .filter(Boolean).join(" · ");
  const shortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function stayMeta() {
    const n = nights();
    if (!$("#inDate").value || !$("#outDate").value || n < 1) return "";
    return `${shortDate($("#inDate").value)} – ${shortDate($("#outDate").value)} · ${plural(n, "night", "nights")}`;
  }
  /* "Free cancellation until …" for the preset policies; custom wording is
     shown as written (in Good to know), never re-interpreted. */
  function cancelDeadline() {
    const t = state.tenant || {};
    const inIso = $("#inDate").value;
    const days = { flexible: 2, moderate: 7, strict: 14 }[t.cancellation_policy];
    if (!days || !inIso) return "";
    const d = new Date(inIso + "T12:00:00");
    d.setDate(d.getDate() - days);
    if (d < new Date()) return "";
    const when = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    return t.cancellation_policy === "strict" ? `50% refund until ${when}` : `Free cancellation until ${when}`;
  }
  /* One card for a room type (book by type) or a specific room. */
  function roomCard({ key, keyAttr, name, facts, desc, photos, feats, rate, stayTotal, tag, tagLow, sel, booked, capacity, plan, problem }) {
    const n = Math.max(1, nights() || 1);
    const tooSmall = (capacity && guestsCount() > capacity) || !!problem;
    const note = capacity && guestsCount() > capacity ? `Sleeps up to ${capacity}: lower your guest count to book`
      : problem ? `${problem}: change who's coming to book` : (booked ? "Not available for these dates" : cancelDeadline());
    const disabled = booked || tooSmall;
    const label = booked ? "Sold out" : sel ? "Selected" : `Select ${name}`;
    return `<article class="bk-room${sel ? " sel" : ""}${booked ? " booked" : ""}">
      <div class="bk-room-media">${photos.length ? `<img src="${esc(photos[0])}" alt="${esc(name)}" loading="lazy">` : `<div class="bk-room-ph">${HOUSE_SVG}<span>${esc(name)}</span></div>`}
        ${tag ? `<span class="bk-tag${tagLow ? " low" : ""}">${esc(tag)}</span>` : ""}${photos.length > 1 ? `<span class="bk-photos">${photos.length} photos</span>` : ""}</div>
      <div class="bk-room-body">
        <div class="bk-room-top"><div><h3>${esc(name)}</h3><p class="bk-facts">${facts.map(esc).join(" · ")}</p></div>
          <div class="bk-price"><p><b>${price(rate)}</b><span> / night</span></p><p class="bk-stay">${price(stayTotal || rate * n)} for ${plural(n, "night", "nights")}</p></div></div>
        ${desc ? `<p class="bk-desc">${esc(desc)}</p>` : ""}
        ${plan ? `<p class="bk-deal">${esc(plan.plan.name)} · save ${money(plan.saved)}</p>` : ""}
        ${feats.length ? `<ul class="bk-amen">${feats.map((f) => `<li>${CHECK_SVG}${esc(f)}</li>`).join("")}</ul>` : ""}
        <div class="bk-room-foot"><p${tooSmall ? ' class="warn"' : ""}>${esc(note)}</p>
          <button class="bk-select" type="button" ${keyAttr}="${esc(key)}" aria-pressed="${sel ? "true" : "false"}"${disabled ? " disabled" : ""}>${esc(label)}</button></div>
      </div>
    </article>`;
  }
  function typeFacts(type, sleeps, extra) {
    const facts = [`Sleeps ${sleeps}`].concat(extra || []);
    if (type) {
      if (Array.isArray(type.beds) && type.beds.length) {
        const beds = new Map();
        type.beds.forEach((b) => { const k = String(b.type || "bed").toLowerCase(); beds.set(k, (beds.get(k) || 0) + (Number(b.qty) || 1)); });
        facts.push([...beds].map(([k, q]) => `${q} ${k}${/bed|crib|cot/.test(k) ? "" : q === 1 ? " bed" : " beds"}`).join(", "));
      }
      if (type.bathrooms) facts.push(`${type.bathrooms} bath`);
      if (type.view) facts.push(type.view);
      if (type.handicap_accessible) facts.push("Accessible");
    }
    return facts;
  }
  function renderRooms() {
    const n = Math.max(1, nights() || 1);
    $("#roomsMeta").textContent = [stayMeta(), splitParty() ? partyText() : plural(guestsCount(), "guest", "guests")].filter(Boolean).join(" · ");
    if (byType()) { renderTypeCards(n); return; }
    $("#roomsList").innerHTML = state.rooms.map((r) => {
      const type = state.types[r.room_type_id] || null;
      const booked = !!(state.available && !state.available.includes(r.id));
      return roomCard({
        key: r.id, keyAttr: "data-room", name: r.name,
        facts: typeFacts(type, (type && type.max_occupants) || r.sleeps || 2),
        desc: type && type.description, photos: r.photos && r.photos.length ? r.photos : (type && type.photos) || [],
        feats: type && Array.isArray(type.features) ? type.features.slice(0, 6) : [],
        rate: baseRate(r), stayTotal: nightlyRatesFor(r).reduce((a, b) => a + b, 0),
        tag: booked ? "Booked" : "", sel: !!(state.selected && state.selected.id === r.id), booked,
        capacity: (type && type.max_occupants) || r.sleeps || 0, plan: applicablePlan(r, n), problem: partyProblem(party, type, state.tenant)
      });
    }).join("") || `<p class="bk-loading">No ${unitWords().many} are listed yet.</p>`;
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
    $("#roomsList").innerHTML = typeGroups().map(({ type, units }) => {
      const free = chooseUnits(units, state.available);
      const availKnown = !!state.available;
      const booked = availKnown && free.length === 0;
      const rep = free[0] || units[0];
      const tag = !availKnown ? (units.length > 1 ? `${units.length} ${unitWords().many}` : "") : booked ? "Sold out" : free.length <= 2 ? `Only ${free.length} left` : `${free.length} available`;
      return roomCard({
        key: type.id, keyAttr: "data-type", name: type.name,
        facts: typeFacts(type, type.max_occupants || rep.sleeps || 2),
        desc: type.description, photos: type.photos && type.photos.length ? type.photos : (rep.photos || []),
        feats: Array.isArray(type.features) ? type.features.slice(0, 6) : [],
        rate: baseRate(rep), stayTotal: nightlyRatesFor(rep).reduce((a, b) => a + b, 0),
        tag, tagLow: availKnown && !booked && free.length <= 2, sel: state.selectedTypeId === type.id, booked,
        capacity: type.max_occupants || rep.sleeps || 0, plan: applicablePlan(rep, n), problem: partyProblem(party, type, state.tenant)
      });
    }).join("") || `<p class="bk-loading">No ${unitWords().many} are listed yet.</p>`;
    postHeight();
  }

  function renderAddons() {
    const wrap = $("#addonsSection");
    wrap.hidden = !state.addons.length;
    $("#addonsList").innerHTML = state.addons.map((a, i) => `
      <label class="bk-addon"><input type="checkbox" data-i="${i}">
        <span class="bk-addon-text"><span class="bk-addon-name">${esc(a.name)}<span>${price(a.price_cents / 100)} <small>/ ${esc(a.per)}</small></span></span>
        ${a.description ? `<span class="bk-addon-desc">${esc(a.description)}</span>` : ""}</span>
      </label>`).join("");
    [...document.querySelectorAll("#addonsList input")].forEach((el) => el.addEventListener("change", renderSummary));
    numberSteps();
  }
  /* 01, 02, 03 on the visible steps (the theme can turn numbering off). */
  function numberSteps() {
    let i = 0;
    document.querySelectorAll("[data-step-num]").forEach((el) => {
      const section = el.closest(".bk-section");
      const on = state.theme ? state.theme.numberedSteps : true;
      el.textContent = section && !section.hidden && on ? String(++i).padStart(2, "0") : "";
    });
  }
  /* What the property calls its units ("cabin", "suite"…): the theme's choice,
     else a guess from the room type names. */
  function unitWords() {
    const names = Object.values(state.types).map((t) => t.name).concat(state.rooms.map((r) => r.name)).join(" ");
    return SHTheme.unitWords(state.theme, names);
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
    const due = round2((total || 0) * pct / 100);
    // Paid by card today: the property's card processing fee, if it passes it on.
    const fee = collectible ? SHMoney.cardCharge(Math.round(due * 100), t.card_fee_mode).fee_cents / 100 : 0;
    return { pct, due, fee, charge: round2(due + fee), collectible };
  }
  async function fnPost(name, body) {
    const res = await fetch(base + "/functions/v1/" + name, {
      method: "POST",
      headers: { apikey: anon, Authorization: "Bearer " + anon, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.details || ("Request failed (" + res.status + ")"));
      err.code = data.message || "";
      err.details = data.details || "";
      throw err;
    }
    return data;
  }

  /* Bot check (Cloudflare Turnstile). The widget stays invisible unless
     Cloudflare wants a click; its one-time token goes with the booking and
     the create-booking function verifies it before anything is saved.
     Tokens are single-use, so the widget resets after every failed try. */
  const ts = { id: null, token: "", failed: false, waiting: [] };
  const tsReady = isPreview || !cfg.TURNSTILE_SITE_KEY ? Promise.resolve(false) : new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve(!!window.turnstile); s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  function tsError(details) {
    return Object.assign(new Error("verification_failed"), { code: "verification_failed", details });
  }
  const TS_LOAD_FAILED = "Our security check couldn't load. Check your connection (or allow challenges.cloudflare.com) and reload the page.";
  function tsSettle(err) {
    const waiting = ts.waiting;
    ts.waiting = [];
    waiting.forEach((done) => done(err));
  }
  async function renderTurnstile() {
    if (ts.id != null || isPreview) return;
    if (!(await tsReady)) { ts.failed = true; tsSettle(tsError(TS_LOAD_FAILED)); return; }
    const box = $("#tsWidget");
    const surface = (state.theme && state.theme.colors.surface) || "#ffffff";
    ts.id = window.turnstile.render(box, {
      sitekey: cfg.TURNSTILE_SITE_KEY,
      action: "booking",
      appearance: "interaction-only",
      size: "flexible",
      theme: SHTheme.onColor(surface) === "#ffffff" ? "dark" : "light",
      callback: (token) => { ts.token = token; box.classList.remove("is-visible"); tsSettle(); postHeight(); },
      "expired-callback": () => { ts.token = ""; },
      "error-callback": () => { ts.token = ""; },
      "before-interactive-callback": () => { box.classList.add("is-visible"); postHeight(); }
    });
  }
  /* One fresh token per booking attempt; waits while Cloudflare checks. */
  async function takeToken() {
    if (!ts.token) {
      if (ts.failed) throw tsError(TS_LOAD_FAILED);
      await new Promise((resolve, reject) => {
        const done = (err) => { clearTimeout(timer); if (err) reject(err); else resolve(); };
        const timer = setTimeout(() => {
          ts.waiting = ts.waiting.filter((f) => f !== done);
          reject(tsError("Please complete the security check above, then try again."));
        }, 120000);
        ts.waiting.push(done);
      });
    }
    const token = ts.token;
    ts.token = "";
    return token;
  }
  function resetTurnstile() {
    ts.token = "";
    if (ts.id != null && window.turnstile) window.turnstile.reset(ts.id);
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
    // The card field sits on a card, so it uses the theme's Card text color
    // (not the page text, which can be light on a dark page) and body font.
    const t = state.theme || SHTheme.normalize({});
    const text = t.colors.surfaceInk, hint = mixHex(text, t.colors.surface, 0.58);
    const elements = state.stripe.elements({ fonts: [{ cssSrc: SHTheme.fontsHref(t) }] });
    state.cardEl = elements.create("card", { style: {
      base: { fontSize: "16px", fontFamily: SHTheme.FONTS[t.bodyFont].stack, color: text, iconColor: text, "::placeholder": { color: hint } },
      invalid: { color: "#a8261d", iconColor: "#a8261d" }
    } });
    state.cardEl.mount("#cardElement");
  }
  /* #rrggbb a over b at weight w (Stripe styles need plain colors, not color-mix). */
  function mixHex(a, b, w) {
    return "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * w + parseInt(b.slice(i, i + 2), 16) * (1 - w))
      .toString(16).padStart(2, "0")).join("");
  }
  $("#cardLabel").addEventListener("click", () => { if (state.cardEl) state.cardEl.focus(); });
  function showSuccess(code, total, extra) {
    // The property still confirms every online booking, so never say "confirmed" here.
    const mode = state.paying && state.paying.mode;
    $("#successPanel h2").textContent = mode === "deposit" ? "Deposit received" : mode === "setup" ? "Booking received" : "Request received";
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
        ? { tenant_id: state.tenant.id, reservation_id: b.resId, show_fee: true }
        : { action: "setup", tenant_id: state.tenant.id, reservation_id: b.resId });
      if (!r.client_secret) throw new Error("no client secret");
      // The server decides the amounts: the deposit, plus any card fee on top.
      const dep = deposit ? (r.amount_cents || b.depositCents) / 100 : 0;
      const fee = deposit ? (r.fee_cents || 0) / 100 : 0;
      const due = deposit ? (r.total_cents || r.amount_cents || b.depositCents) / 100 : 0;
      state.paying = { mode: deposit ? "deposit" : "setup", clientSecret: r.client_secret, due, fee };
      $("#payTitle").textContent = deposit ? "Deposit payment" : "Card to hold your booking";
      $("#payText").textContent = deposit
        ? `A deposit of ${money(dep)} (${b.depositPct}% of ${money(b.total)})${fee > 0 ? ` plus a ${money(fee)} card processing fee, ${money(due)} in all,` : ""} is due today to confirm ${state.selected.name}. The balance is due at the property.`
        : `${state.tenant.name} requires a card to hold your ${state.selected.name} booking. Nothing is charged now — Stripe keeps the card securely for your balance and the cancellation policy.`;
      $("#payPanel").hidden = false;
      await mountCard();
      btn.disabled = false;
      btn.textContent = deposit ? "Pay " + money(due) : "Save card & confirm booking";
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
      showSuccess(b.code, b.total, ` Your ${money(pay.due)} payment${pay.fee > 0 ? " (deposit and card fee)" : " (deposit)"} went through — the remaining balance is due at the property.`);
    } catch (e) {
      pErr.textContent = e.message || "Payment failed. Please check the card and try again.";
      pErr.hidden = false;
      btn.disabled = false;
      btn.textContent = pay.mode === "setup" ? "Save card & confirm booking" : "Pay " + money(pay.due);
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
  const RULES_SHOWN = 4; // the rest fold behind "Read all N house rules"
  function renderTerms() {
    const t = state.tenant;
    if (!t) return;
    const rawTerms = (t.rental_terms || "").trim();
    const lines = rawTerms.split(/\r?\n/).map((line) => line.trim().replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, "")).filter(Boolean);
    const policy = cancellationText(t);
    const hasTimes = !!(t.check_in_time || t.check_out_time);
    const section = $("#termsSection");
    section.hidden = !(lines.length || policy || hasTimes);
    numberSteps();
    if (section.hidden) return;
    const tiles = [];
    if (t.check_in_time) tiles.push(`<div class="bk-tile"><span>Check-in</span><b>from ${esc(t.check_in_time)}</b></div>`);
    if (t.check_out_time) tiles.push(`<div class="bk-tile"><span>Check-out</span><b>by ${esc(t.check_out_time)}</b></div>`);
    if (policy) tiles.push(`<div class="bk-tile${policy.length > 70 ? " wide" : ""}"><span>Cancellation</span><b class="small">${esc(policy)}</b></div>`);
    $("#termsTimes").innerHTML = tiles.join("");
    $("#termsCancellation").hidden = true; // the policy lives in its tile
    $("#termsRules").hidden = !lines.length;
    $("#termsList").innerHTML = lines.map((line, i) => `<li${i >= RULES_SHOWN ? ' class="extra"' : ""}>${esc(line)}</li>`).join("");
    const toggle = $("#termsToggle");
    toggle.hidden = lines.length <= RULES_SHOWN;
    $("#termsToggleText").textContent = `Read all ${lines.length} house rules`;
    $("#termsAckWrap").hidden = !lines.length;
    renderPolicyNote();
  }
  function renderPolicyNote() {
    const t = state.tenant || {};
    const deadline = cancelDeadline();
    const policy = cancellationText(t);
    $("#summaryPolicyNote").textContent = deadline ? deadline + "." : policy ? (policy.length > 140 ? policy.slice(0, 137).trimEnd() + "…" : policy) : "Cancellation follows the property policy.";
  }

  /* Summary header + "what happens today" note follow the dates, guests and
     the property's card/deposit rules. */
  function renderSummaryMeta() {
    $("#summaryMeta").textContent = [stayMeta(), splitParty() ? partyText() : plural(guestsCount(), "guest", "guests")].filter(Boolean).join(" · ");
    const dep = state.tenant && state.tenant.deposit_enabled;
    $("#trustChargeText").textContent = dep
      ? `A ${Math.min(100, Math.max(1, parseInt(state.tenant.deposit_percent, 10) || 25))}% deposit is due when you book; the balance is paid at the property.`
      : cardRequired() ? "A card holds your booking. Nothing is charged today." : "No payment is taken today.";
    renderPolicyNote();
  }
  function renderSummary() {
    const n = nights();
    const btn = $("#bookBtn");
    renderSummaryMeta();
    if (!state.selected || !n || n < 1) {
      const unit = unitWords().one;
      $("#summaryBody").innerHTML = !state.selected
        ? `<div class="bk-empty">${HOUSE_SVG}<p>Pick ${esc(SHTheme.withArticle(unit))} to see your total.</p></div>`
        : `<p class="bk-muted">Check-out must be after check-in.</p>`;
      btn.disabled = true;
      btn.textContent = state.selected ? "Fix your dates" : `Choose ${SHTheme.withArticle(unit)} to continue`;
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
    const limit = partyProblem(party, type, state.tenant);
    if (limit) {
      $("#summaryBody").innerHTML = `<p class="bk-muted">${esc(limit)} for this ${esc(unitWords().one)}. Change who's coming or pick another.</p>`;
      btn.disabled = true; btn.textContent = limit;
      return null;
    }
    const ap = applicablePlan(state.selected, n);
    const included = ap && ap.plan.includedOccupants != null ? ap.plan.includedOccupants
      : type && type.included_adults != null ? type.included_adults
      : state.tenant && state.tenant.included_occupants != null ? state.tenant.included_occupants : 2;
    const num = (v) => Number(v) || 0;
    const occ = occupancyCharge({
      adults: party.adults, children: party.children, infants: party.infants, included: num(included),
      includedChildren: num(type && type.included_children), includedInfants: num(type && type.included_infants),
      adultRate: ap && ap.plan.extraAdultRate ? num(ap.plan.extraAdultRate) : num(type && type.extra_adult_cents) / 100,
      childRate: ap && num(ap.plan.extraChildRate) > 0 ? num(ap.plan.extraChildRate) : num(type && type.extra_child_cents) / 100,
      infantRate: ap && num(ap.plan.extraInfantRate) > 0 ? num(ap.plan.extraInfantRate) : num(type && type.extra_infant_cents) / 100
    });
    const addonPayload = chosenAddons().map((a) => ({ name: a.name, price: a.price_cents / 100, per: a.per, qty: 1 }));
    if (occ.perNight > 0) addonPayload.push({ name: `Extra guests × ${occ.count}`, price: occ.perNight, per: "night", qty: 1 });
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
      `<div class="bk-line"><span>${esc(byType() && type ? type.name : state.selected.name)} × ${plural(n, "night", "nights")}${byType() ? `<small>Your ${esc(unitWords().one)} is assigned when you book</small>` : ""}</span><b>${money(q.subtotal)}</b></div>` +
      (ap ? `<div class="bk-line save"><span>${esc(ap.plan.name)} applied</span><b>−${money(ap.saved)}</b></div>` : "") +
      (!ap && code ? `<div class="bk-line note"><span>Code ${esc(code)} didn't apply to this stay</span></div>` : "") +
      q.addonLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      q.taxLines.map((l) => `<div class="bk-line"><span>${esc(l.name)}</span><b>${money(l.amount)}</b></div>`).join("") +
      (dep && dep.fee > 0 ? `<div class="bk-line"><span>Card processing fee<small>On today's card payment</small></span><b>${money(dep.fee)}</b></div>` : "") +
      `<div class="bk-line total"><span>Total</span><b>${money(round2(q.total + (dep ? dep.fee : 0)))}</b></div>` +
      (dep ? `<div class="bk-line due"><span>Due today (${dep.pct}% deposit${dep.fee > 0 ? " + card fee" : ""})</span><b>${money(dep.charge)}</b></div><div class="bk-line"><span>Balance at the property</span><b>${money(round2(q.total - dep.due))}</b></div>`
        : cardRequired() ? `<div class="bk-line due"><span>Due today · card holds booking</span><b>${money(0)}</b></div>` : "");
    if (state.paying) { btn.disabled = false; btn.textContent = state.paying.mode === "setup" ? "Save card & confirm booking" : "Pay " + money(state.paying.due); }
    else if (state.booked) { btn.disabled = false; btn.textContent = "Try the card form again"; }
    else if (termsRequired() && !$("#gTermsAck").checked) { btn.disabled = true; btn.textContent = "Agree to the house rules to continue"; }
    else if (needsAck && !$("#depAck").checked) { btn.disabled = true; btn.textContent = "Tick the deposit box to continue"; }
    else {
      btn.disabled = false;
      btn.textContent = dep && dep.collectible ? "Book & pay " + money(dep.charge)
        : cardRequired() && !dep ? "Book · add card to hold" : "Request booking · " + money(q.total);
    }
    postHeight();
    return q;
  }

  let availSeq = 0; // only the latest date change may update availability
  async function checkAvailability() {
    const seq = ++availSeq;
    try {
      const rows = await api("rpc/get_available_room_ids", {
        method: "POST",
        body: JSON.stringify({ p_tenant: state.tenant.id, p_check_in: $("#inDate").value, p_check_out: $("#outDate").value })
      });
      if (seq !== availSeq) return; // an older request answered late
      state.available = (rows || []).map((r) => (typeof r === "string" ? r : r.get_available_room_ids))
        .filter((id) => { const room = state.rooms.find((x) => x.id === id); return room && !ruleBlock(room); });
      $("#availNote").hidden = false;
      $("#availNote").textContent = byType()
        ? typeGroups().filter((g) => chooseUnits(g.units, state.available).length).length + " room types available for these dates — we assign your exact room when you book."
        : state.available.length + " of " + state.rooms.length + " rooms available for these dates.";
    } catch {
      if (seq !== availSeq) return;
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

  const TYPE_COLS = "id,name,description,bathrooms,view,smoking_policy,min_stay,max_stay,rack_rate_cents,extra_adult_cents,extra_child_cents,extra_infant_cents,included_adults,included_children,included_infants,max_adults,max_children,max_infants,adults_required,max_occupants,beds,handicap_accessible,accessible_features,features,photos";
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

  /* Name, headline, hero, logo, footer contact. `content` carries unsaved
     studio edits in preview mode; normally everything comes from the tenant. */
  function presentTenant(content = {}) {
    const t = state.tenant;
    const pick = (key, fallback) => (content[key] !== undefined ? content[key] : fallback);
    const name = pick("name", t.name) || t.name;
    const words = unitWords();
    document.title = "Book · " + name;
    $("#propName").textContent = name;
    $("#aboutTitle").textContent = name;
    $("#propHeadline").textContent = pick("headline", t.booking_headline) || ("Stay at " + name);
    $("#propSub").textContent = pick("sub", t.booking_subheading) || t.description || "";
    const eyebrow = state.theme.eyebrow || [t.city, t.state].filter(Boolean).join(", ");
    $("#propEyebrow").textContent = eyebrow;
    $("#propEyebrow").hidden = !eyebrow;
    $("#navUnits").textContent = words.many.replace(/^./, (c) => c.toUpperCase());
    $("#unitsTitle").textContent = "Choose your " + words.one;
    $("#gArrivalHint").textContent = t.check_in_time ? "Optional · check-in from " + t.check_in_time : "Optional";

    const heroEl = $("#bkHero");
    const heroUrl = safeUrl(pick("heroUrl", t.hero_image_url), { httpsOnly: true });
    const focus = pick("heroFocus", { x: t.hero_focus_x, y: t.hero_focus_y }) || {};
    const pct = (v, dflt) => (v == null || isNaN(Number(v)) ? dflt : Math.min(100, Math.max(0, Number(v))));
    heroEl.classList.toggle("has-img", !!heroUrl);
    if (heroUrl) {
      heroEl.style.backgroundImage = `linear-gradient(180deg, rgb(14 22 17 / 0%) 30%, rgb(14 22 17 / 72%) 100%), url("${heroUrl.replace(/["\\]/g, encodeURIComponent)}")`;
      heroEl.style.backgroundPosition = `${pct(focus.x, 50)}% ${pct(focus.y, 35)}%`;
    } else {
      heroEl.style.backgroundImage = "";
      heroEl.style.backgroundPosition = "";
    }

    const mk = $("#propMark");
    const logo = safeUrl(t.logo_url, { httpsOnly: true });
    mk.classList.toggle("has-logo", !!logo);
    if (logo) mk.innerHTML = `<img src="${esc(logo)}" alt="">`;
    else mk.textContent = (name || "S").slice(0, 1).toUpperCase();

    // Footer: description + contact as real links (tel:, mailto:, website, socials).
    const addr = [t.address_line1, t.address_line2, [t.city, t.state].filter(Boolean).join(", "), t.postcode, t.country].filter(Boolean).join(", ");
    const contact = [];
    if (addr) contact.push(`<span>${esc(addr)}</span>`);
    if (t.phone) contact.push(`<a href="tel:${esc(String(t.phone).replace(/[^\d+]/g, ""))}">${esc(t.phone)}</a>`);
    if (t.contact_email) contact.push(`<a href="mailto:${esc(t.contact_email)}">${esc(t.contact_email)}</a>`);
    if (safeUrl(t.website_url)) contact.push(`<a href="${esc(safeUrl(t.website_url))}" target="_blank" rel="noopener">Property website</a>`);
    $("#aboutContact").innerHTML = contact.join("");
    $("#aboutDesc").textContent = t.description || "";
    $("#aboutSocials").innerHTML = [["Facebook", t.facebook_url], ["Instagram", t.instagram_url], ["Twitter / X", t.twitter_url], ["YouTube", t.youtube_url]]
      .map(([label, u]) => [label, safeUrl(u)])
      .filter(([, u]) => u).map(([label, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`).join("");
    const st = $("#aboutStars");
    st.hidden = !(t.star_rated && t.star_count);
    if (!st.hidden) st.textContent = "★".repeat(Math.min(5, t.star_count)) + " rated property";
    $("#gConsentWrap").hidden = !t.gdpr_consent;
  }

  async function load() {
    if (!base || !anon) { showError("Booking is not configured yet. Please contact the property directly."); return; }
    try {
      // Public booking profile only — never select=*: tenants also hold
      // secrets (ical_token, Stripe customer ids, private notification
      // emails) that the anon key must not be able to read (see the
      // 20261112000000_demo_lockdown migration).
      const tenantCols = "id,name,slug,card_fee_mode,contact_email,phone,logo_url,booking_theme,hero_image_url,hero_focus_x,hero_focus_y,booking_headline,booking_subheading,description,address_line1,address_line2,postcode,city,state,country,website_url,facebook_url,instagram_url,twitter_url,youtube_url,star_rated,star_count,gdpr_consent,check_in_time,check_out_time,cancellation_policy,cancellation_policy_text,rental_terms,currency,stripe_account_id,stripe_onboarding_complete,ga_measurement_id,booking_redirect_url,deposit_enabled,deposit_percent,booking_by_type,included_occupants,maximum_total_occupants,maximum_adults,maximum_children,maximum_infants,guest_address_mode,min_room_rate_cents";
      const tenants = await api("tenants?slug=eq." + encodeURIComponent(slug) + "&select=" + tenantCols);
      state.tenant = tenants && tenants[0];
      if (!state.tenant) { showError("We could not find this property. Check the link and try again."); return; }
      const t = state.tenant;
      window.SH_TENANT_ID = t.id; // error reports name the property
      state.theme = SHTheme.apply(t.booking_theme);
      presentTenant();
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
      presentTenant(); // unit words can now come from the room types
      renderTurnstile();
      presentGuestFields();
      setGuests(guestsCount());
      renderTerms();
      renderRooms(); renderAddons(); renderSummary(); postHeight();
      if (paidRef) showPaidThanks();
      if (isPreview && window.parent !== window) window.parent.postMessage({ type: "simplehotelier:preview-ready" }, location.origin);
    } catch (e) {
      showError("Booking is temporarily unavailable. Please contact the property directly.");
      if (window.SHReportError) window.SHReportError(e, "booking page load");
    }
  }

  /* Guests: a −/+ stepper over the hidden #guests input, capped by the property. */
  function setGuests(v) {
    const cap = Number(state.tenant && state.tenant.maximum_total_occupants) || 16;
    setParty({ adults: Math.min(cap, Math.max(1, v)), children: 0, infants: 0 });
  }
  /* Keep the party within the property's own limits; room types add theirs. */
  function setParty(next) {
    const t = state.tenant || {};
    const cap = Number(t.maximum_total_occupants) || 16;
    const lim = (v, d) => Number(v) > 0 ? Number(v) : d;
    party.adults = Math.min(lim(t.maximum_adults, cap), cap, Math.max(1, next.adults | 0));
    party.children = Math.min(lim(t.maximum_children, cap), cap - party.adults, Math.max(0, next.children | 0));
    party.infants = Math.min(lim(t.maximum_infants, 10), Math.max(0, next.infants | 0));
    $("#guests").value = guestsCount();
    $("#guestsOut").textContent = plural(guestsCount(), "guest", "guests");
    $("#guestsSimple").querySelectorAll("[data-step]").forEach((b) => {
      b.disabled = (+b.dataset.step < 0 && party.adults <= 1) || (+b.dataset.step > 0 && guestsCount() >= cap);
    });
    $("#guestsSummary").textContent = partyText();
    const max = { adults: Math.min(lim(t.maximum_adults, cap), cap - party.children), children: Math.min(lim(t.maximum_children, cap), cap - party.adults), infants: lim(t.maximum_infants, 10) };
    document.querySelectorAll("#guestsPop [data-who]").forEach((row) => {
      const who = row.dataset.who;
      row.querySelector("output").textContent = party[who];
      row.querySelector('[data-step="-1"]').disabled = party[who] <= (who === "adults" ? 1 : 0);
      row.querySelector('[data-step="1"]').disabled = party[who] >= max[who];
    });
  }
  $("#guestsSimple").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b || b.disabled) return;
    setGuests(guestsCount() + Number(b.dataset.step));
    renderRooms(); renderSummary();
  });
  $("#guestsPop").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b || b.disabled) return;
    const who = b.closest("[data-who]").dataset.who;
    setParty({ ...party, [who]: party[who] + Number(b.dataset.step) });
    renderRooms(); renderSummary();
  });
  function togglePartyPicker(open) {
    $("#guestsPop").hidden = !open;
    $("#guestsBtn").setAttribute("aria-expanded", String(open));
    if (open) $('#guestsPop [data-who="adults"] [data-step="1"]').focus();
  }
  $("#guestsBtn").addEventListener("click", () => togglePartyPicker($("#guestsPop").hidden));
  $("#guestsDone").addEventListener("click", () => { togglePartyPicker(false); $("#guestsBtn").focus(); });
  document.addEventListener("click", (e) => { if (!$("#guestsPop").hidden && !e.target.closest(".bk-guests")) togglePartyPicker(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#guestsPop").hidden) { togglePartyPicker(false); $("#guestsBtn").focus(); } });
  /* Switch to the party picker / show the address form, per property. */
  function presentGuestFields() {
    const split = splitParty();
    $("#guestsSimple").hidden = split;
    $("#guestsBtn").hidden = !split;
    $("#guestsLabel").textContent = split ? "Who's coming" : "Guests";
    const mode = (state.tenant && state.tenant.guest_address_mode) || "off";
    $("#gAddress").hidden = mode === "off";
    $("#gAddressHint").textContent = mode === "required" ? "Required by the property" : "Optional";
    ["gAddr1", "gCity", "gPostcode", "gCountry"].forEach((id) => { $("#" + id).required = mode === "required"; });
  }
  $("#termsToggle").addEventListener("click", () => {
    const box = $("#termsRules");
    const open = box.classList.toggle("open");
    $("#termsToggle").setAttribute("aria-expanded", String(open));
    $("#termsToggleText").textContent = open ? "Hide full house rules" : `Read all ${document.querySelectorAll("#termsList li").length} house rules`;
    postHeight();
  });
  if (isPreview) {
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== "simplehotelier:preview" || !state.tenant) return;
      state.theme = SHTheme.apply(e.data.theme || {});
      presentTenant(e.data.content || {});
      renderTerms(); renderRooms(); renderAddons(); renderSummary();
    });
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
    if (isPreview) { showError("This is a preview — open your booking page to make a real booking."); return; }
    if (state.paying) { await payDeposit(); return; }
    if (state.booked) { await startCardStep(); return; }
    showError("");
    const name = $("#gName").value.trim();
    const email = $("#gEmail").value.trim();
    if (!state.selected) { showError("Please select a room first."); return; }
    if (!name || !email) { showError("Please add your name and email so the property can confirm."); $("#gName").focus(); return; }
    const addressMode = (state.tenant && state.tenant.guest_address_mode) || "off";
    const address = { line1: $("#gAddr1").value.trim(), line2: $("#gAddr2").value.trim(), city: $("#gCity").value.trim(),
      state: $("#gState").value.trim(), postcode: $("#gPostcode").value.trim(), country: $("#gCountry").value.trim() };
    if (addressMode === "required") {
      const missing = [["gAddr1", "line1"], ["gCity", "city"], ["gPostcode", "postcode"], ["gCountry", "country"]].find(([, k]) => !address[k]);
      if (missing) { showError("Please add your home address: street, city, ZIP / postal code and country."); $("#" + missing[0]).focus(); return; }
    }
    if (termsRequired() && !$("#gTermsAck").checked) { showError("Please read and agree to the property's terms and house rules before booking."); $("#gTermsAck").focus(); return; }
    const q = renderSummary();
    if (!q) { showError("Please fix your dates."); return; }
    const btn = $("#bookBtn");
    btn.disabled = true; btn.textContent = "Running a quick security check…";
    const selAddons = chosenAddons();
    const consentEl = $("#gConsent");
    try {
      /* The server prices the stay from the property's own rates, assigns a
         free unit (by type: first free one; two guests racing for the last
         unit can't both win), generates the confirmation code and stores
         the request. The quote shown above is only a preview. The
         create-booking function checks the Turnstile token, then calls
         create_booking() (no longer open to browsers directly). */
      const turnstileToken = await takeToken();
      btn.textContent = "Sending…";
      const booked = await fnPost("create-booking", {
        turnstile_token: turnstileToken,
        booking: {
          p_tenant: state.tenant.id,
          p_room: byType() && state.selectedTypeId ? null : state.selected.id,
          p_room_type: byType() && state.selectedTypeId ? state.selectedTypeId : null,
          p_check_in: $("#inDate").value, p_check_out: $("#outDate").value,
          p_guests: guestsCount(), p_children: party.children, p_infants: party.infants,
          p_guest_address: addressMode === "off" ? null : address,
          p_name: name, p_email: email, p_phone: $("#gPhone").value.trim() || null,
          p_requests: $("#gNotes").value.trim() || null,
          p_addon_ids: selAddons.map((a) => a.id),
          p_promo: ($("#promoCode").value || "").trim().toUpperCase() || null,
          p_marketing_consent: !!(consentEl && !$("#gConsentWrap").hidden && consentEl.checked),
          p_terms_accepted: termsRequired() && $("#gTermsAck").checked,
          p_arrival_time: $("#gArrival").value || null
        }
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
      resetTurnstile(); // the token is spent; get a fresh one for the retry
      btn.disabled = false; btn.textContent = "Request booking";
      showError(bookingErrorText(e));
      // Known refusals (sold out, throttled, bot check) are expected; anything else is a bug.
      if (!(e && e.details && /^[a-z_]+$/.test(e.code || "")) && window.SHReportError) window.SHReportError(e, "booking request");
      if (e && e.code === "unavailable" && state.tenant) checkAvailability().catch(() => {});
    }
  });

  load();
})();
