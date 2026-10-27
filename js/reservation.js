/* SimpleHotelier — reservation editor (Details / Payments / Notes).
   Opens from the Reservations list, calendar, folios, search and
   "New reservation". Live accounts price and save through the database
   (staff_quote / save_reservation: totals are never computed in the
   browser) and move money through charge-guest (card on file, payment
   links, refunds) or record_manual_payment (cash, bank transfer, check).
   Demo mode edits the sample data in this browser only.
   Loaded after js/app.js and uses its helpers ($, esc, money, openModal…). */
"use strict";

const RX_SOURCES = [["direct", "Direct / website"], ["phone", "Phone"], ["walkin", "Walk-in"], ["airbnb", "Airbnb"], ["vrbo", "Vrbo"], ["other", "Other"]];
const RX_STATUSES = [["pending", "Pending"], ["confirmed", "Confirmed"], ["checked-in", "Checked in"], ["checked-out", "Checked out"], ["cancelled", "Cancelled"]];
const RX_ARRIVALS = ["", "Before 12 PM", "12 – 2 PM", "2 – 4 PM", "4 – 6 PM", "6 – 8 PM", "After 8 PM"];
const RX_METHODS = ["Cash", "Bank transfer", "Check", "Other"];
const RX_PRICE_FIELDS = ["checkIn", "checkOut", "typeId", "roomCode", "plan", "adults", "children", "discount", "keepRates", "addon"];

let rx = null; // the open editor's state; null when no editor is showing
let rxQuoteSeq = 0, rxQuoteTimer = null;

const rxLive = () => !!(window.SHDB && SHDB.hasLive());
const rxCents = (n) => Math.round((Number(n) || 0) * 100);
const rxStatusDb = (s) => ({ "checked-in": "checked_in", "checked-out": "checked_out" }[s] || s);
const rxStatusApp = (s) => ({ checked_in: "checked-in", checked_out: "checked-out" }[s] || s);
const rxNights = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / dayMs);
const rxOpen = () => !!(rx && $("#modal .rx"));
function rxSplitName(full) {
  const t = String(full || "").trim();
  const i = t.lastIndexOf(" ");
  return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ""];
}
function rxCardLabel(card) {
  if (!card || !card.last4) return "";
  const brand = String(card.brand || "card").replace(/^./, (c) => c.toUpperCase());
  const exp = card.expMonth ? ` · exp ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear || "").slice(-2)}` : "";
  return `${brand} •••• ${card.last4}${exp}`;
}
function rxOptions(list, current) {
  return list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(current) ? " selected" : ""}>${esc(l)}</option>`).join("");
}

/* Room types with their units; untyped rooms are grouped under "Other rooms". */
function rxTypeGroups() {
  const groups = roomTypes.map((t) => ({ id: t.id, name: t.name, plans: normalizeRoomType(t).ratePlans, units: rooms.filter((r) => typeOfRoom(r) && typeOfRoom(r).id === t.id) }))
    .filter((g) => g.units.length);
  const loose = rooms.filter((r) => !typeOfRoom(r));
  if (loose.length) groups.push({ id: "", name: "Other rooms", plans: [], units: loose });
  return groups;
}
const rxGroup = (typeId) => rxTypeGroups().find((g) => g.id === (typeId || "")) || rxTypeGroups()[0] || { id: "", name: "", plans: [], units: [] };

/* ---------------------------------------------------------------- open */
async function openReservationEditor(ref, opts = {}) {
  const base = ref ? reservations.find((x) => x.ref === ref || x.guest === ref) : null;
  if (ref && !base) return;
  if (!ref && !rooms.length) { toast("Add a room first", "Reservations need at least one room or cabin", "warn"); return; }
  rx = { base, row: null, txns: [], addonIds: new Set(), tab: opts.tab || "details", panel: opts.panel || null,
    quote: null, quoteError: "", dirtyPrice: false, confirmCancel: false, busy: false, link: "" };
  if (base && base.id && rxLive()) {
    openModal({ title: `${base.ref} · ${base.guest}`, sub: "Loading booking…", body: `<p class="hint">Loading the latest details…</p>`, xl: true });
    try {
      const bundle = await SHDB.reservationBundle(base.id);
      if (!bundle) { toast("Booking not found", "It may have been deleted", "warn"); closeModal(); rx = null; return; }
      rx.row = bundle.row;
      rx.txns = bundle.txns;
      bundle.addons.forEach((a) => { if (a.addon_id) rx.addonIds.add(a.addon_id); });
      Object.assign(base, bundle.mapped);
    } catch {
      toast("Could not load this booking", "Check your connection and try again", "warn");
      closeModal(); rx = null; return;
    }
  }
  rx.form = rxInitialForm();
  rx.readOnly = !!(rx.row && rx.row.ical_feed_id);
  rxRender();
  if (!base) rxRequote(); // new bookings show their price straight away
}

function rxInitialForm() {
  const r = rx.row, b = rx.base;
  if (r) {
    const [first, last] = rxSplitName(r.guest_name);
    const room = rooms.find((x) => x.id === r.room_id) || roomByCode(b.room);
    return {
      checkIn: String(r.check_in).slice(0, 10), checkOut: String(r.check_out).slice(0, 10),
      typeId: room && typeOfRoom(room) ? typeOfRoom(room).id : "", roomCode: room ? room.code : "",
      plan: r.rate_plan_id || "standard", adults: r.adults || 1, children: r.children || 0, infants: r.infants || 0,
      discount: (r.discount_cents || 0) / 100, keepRates: true,
      first, last, email: r.guest_email || "", phone: r.guest_phone || "",
      addr1: r.guest_address_line1 || "", addr2: r.guest_address_line2 || "", city: r.guest_city || "", state: r.guest_state || "",
      postcode: r.guest_postcode || "", country: r.guest_country || "", arrival: r.arrival_time || "",
      source: r.source || "direct", status: rxStatusApp(r.status), notes: r.notes || "", staffNotes: r.staff_notes || ""
    };
  }
  if (b) { // demo booking
    const [first, last] = rxSplitName(b.guest);
    const room = roomByCode(b.room);
    return {
      checkIn: b.checkIn || isoLocal(addDays(b.inN)), checkOut: b.checkOut || isoLocal(addDays(b.outN)),
      typeId: room && typeOfRoom(room) ? typeOfRoom(room).id : "", roomCode: b.room, plan: "standard",
      adults: b.adults || 2, children: 0, infants: 0, discount: 0, keepRates: true,
      first, last, email: b.contact && b.contact.includes("@") ? b.contact : "", phone: b.contact && !b.contact.includes("@") && b.contact !== "—" ? b.contact : "",
      addr1: "", addr2: "", city: "", state: "", postcode: "", country: "", arrival: "",
      source: b.source || "direct", status: b.status, notes: b.notes || "", staffNotes: ""
    };
  }
  const g = rxTypeGroups()[0];
  return {
    checkIn: isoLocal(TODAY), checkOut: isoLocal(addDays(1)), typeId: g ? g.id : "", roomCode: g && g.units[0] ? g.units[0].code : "",
    plan: "", adults: 2, children: 0, infants: 0, discount: 0, keepRates: false,
    first: "", last: "", email: "", phone: "", addr1: "", addr2: "", city: "", state: "", postcode: "", country: "", arrival: "",
    source: "phone", status: "confirmed", notes: "", staffNotes: ""
  };
}

/* ---------------------------------------------------------------- render */
function rxRender() {
  const f = rx.form, isNew = !rx.base;
  const code = rx.base ? rx.base.ref : "New reservation";
  const guestName = [f.first, f.last].filter(Boolean).join(" ");
  const dis = rx.readOnly ? " disabled" : "";
  const field = (key, label, attrs = "") => `<div class="field"><label for="rx-${key}">${label}</label><input class="input" id="rx-${key}" data-rx-field="${key}" value="${esc(f[key])}"${attrs}${dis}></div>`;
  const g = rxGroup(f.typeId);
  const card = rx.row && rx.row.card_last4 ? { brand: rx.row.card_brand, last4: rx.row.card_last4, expMonth: rx.row.card_exp_month, expYear: rx.row.card_exp_year } : null;
  const payCount = rx.txns.length;
  openModal({
    title: isNew ? "New reservation" : `${code} · ${guestName || rx.base.guest}`,
    sub: isNew ? "Phone, walk-in or manual booking — priced from your rates when you save" : `${rxSourceLabel(f.source)} booking · created ${rx.row ? new Date(rx.row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "in this browser"}`,
    xl: true,
    body: `
<div class="rx">
  <div class="rx-tabs" role="tablist">
    ${[["details", "Details"], ["payments", `Payments${payCount ? ` <span class="rx-count">${payCount}</span>` : ""}`], ["notes", "Notes"]]
      .map(([k, l]) => `<button type="button" role="tab" data-rx="tab" data-tab="${k}" aria-selected="${rx.tab === k}" class="${rx.tab === k ? "active" : ""}"${isNew && k === "payments" ? " disabled" : ""}>${l}</button>`).join("")}
  </div>
  ${rx.readOnly ? `<div class="rx-banner">Imported from the ${esc(rxSourceLabel(f.source))} calendar. Change it there — edits here would be replaced at the next sync.</div>` : ""}

  <div class="rx-top" data-pane="details"${rx.tab === "details" ? "" : " hidden"}>
    <div class="rx-dates">
      <div class="field"><label for="rx-checkIn">Check in</label><input class="input" type="date" id="rx-checkIn" data-rx-field="checkIn" value="${esc(f.checkIn)}"${dis}></div>
      <div class="field"><label for="rx-checkOut">Check out</label><input class="input" type="date" id="rx-checkOut" data-rx-field="checkOut" value="${esc(f.checkOut)}"${dis}></div>
      ${isNew ? "" : `<label class="check-item rx-keep"><input type="checkbox" data-rx-field="keepRates"${f.keepRates ? " checked" : ""}${dis}><span>Keep rates for existing dates</span></label>`}
      <div class="rx-stay"><span>Length of stay <b id="rxNightsText"></b></span><span>Booking status <b id="rxStatusText"></b></span></div>
    </div>
    <div class="rx-band">
      <div class="field rx-w2"><label for="rx-typeId">Room type</label><select class="select" id="rx-typeId" data-rx-field="typeId"${dis}>${rxOptions(rxTypeGroups().map((x) => [x.id, x.name]), f.typeId)}</select></div>
      <div class="field rx-w2"><label for="rx-plan">Room rate</label><select class="select" id="rx-plan" data-rx-field="plan"${dis}>${rxPlanOptions(g, f.plan)}</select></div>
      <div class="field rx-w2"><label for="rx-roomCode">Room #</label><select class="select" id="rx-roomCode" data-rx-field="roomCode"${dis}>${rxOptions(g.units.map((u) => [u.code, `${u.code} · ${u.name}`]), f.roomCode)}</select></div>
      <div class="field"><label for="rx-adults">Adults</label><input class="input" type="number" min="1" max="50" id="rx-adults" data-rx-field="adults" value="${esc(f.adults)}"${dis}></div>
      <div class="field"><label for="rx-children">Children</label><input class="input" type="number" min="0" max="50" id="rx-children" data-rx-field="children" value="${esc(f.children)}"${dis}></div>
      <div class="field"><label for="rx-infants">Infants</label><input class="input" type="number" min="0" max="20" id="rx-infants" data-rx-field="infants" value="${esc(f.infants)}"${dis}></div>
      <div class="field rx-w2"><label>Room</label><output class="input rx-out" id="rxRoomOut">—</output></div>
      <div class="field rx-w2"><label>Extra person</label><output class="input rx-out" id="rxExtraOut">—</output></div>
      <div class="field rx-w2"><label for="rx-discount">Discount ($)</label><input class="input mono" type="number" min="0" step="0.01" id="rx-discount" data-rx-field="discount" value="${esc(f.discount || 0)}"${dis}></div>
    </div>
    ${addons.length ? `<div class="rx-extras"><span class="rx-label">Extras</span>${addons.filter((a) => a.on || rx.addonIds.has(a.id)).map((a) => `<label class="rx-chip"><input type="checkbox" data-rx-field="addon" value="${esc(a.id || a.name)}"${rx.addonIds.has(a.id || a.name) ? " checked" : ""}${dis}><span>${esc(a.name)} · ${money(a.price)}<small> / ${esc(a.per)}</small></span></label>`).join("")}</div>` : ""}
  </div>

  <div class="rx-grid">
    <div class="rx-left">
      <section data-pane="details"${rx.tab === "details" ? "" : " hidden"}>
        <h3 class="rx-h">Primary contact</h3>
        <div class="rx-contact">
          ${field("first", "First name", ' autocomplete="off"')}
          ${field("last", "Last name", ' autocomplete="off"')}
          ${field("email", "Email", ' type="email" autocomplete="off"')}
          ${field("phone", "Phone number", ' type="tel" autocomplete="off"')}
          <div class="rx-span2">${field("addr1", "Address")}</div>
          ${field("city", "City")}
          ${field("state", "State / region")}
          <div class="rx-span2">${field("addr2", "Address line 2")}</div>
          ${field("postcode", "Postcode")}
          ${field("country", "Country")}
          <div class="field"><label for="rx-arrival">Arrival time</label><select class="select" id="rx-arrival" data-rx-field="arrival"${dis}>${rxOptions(RX_ARRIVALS.map((a) => [a, a || "Not set"]), f.arrival)}</select></div>
          <div class="field"><label for="rx-source">Source of reservation</label><select class="select" id="rx-source" data-rx-field="source"${dis}>${rxOptions(RX_SOURCES, f.source)}</select></div>
          <div class="field rx-span2"><label>Card on file</label><div class="rx-card${card ? "" : " none"}">${card ? `<span class="rx-card-brand">${esc(String(card.brand || "card").toUpperCase())}</span>${esc(rxCardLabel(card))}${rx.row.cardholder_name ? ` <small>· ${esc(rx.row.cardholder_name)}</small>` : ""}` : "No card saved — cards are saved when a guest books online, pays a deposit or pays a payment request"}</div></div>
        </div>
        <div class="field"><label for="rx-notes">Guest comments</label><textarea class="textarea" id="rx-notes" data-rx-field="notes" placeholder="Requests and details from the guest"${dis}>${esc(f.notes)}</textarea></div>
      </section>

      <section data-pane="payments"${rx.tab === "payments" ? "" : " hidden"}>
        <h3 class="rx-h">Card on file</h3>
        <div class="rx-card${card ? "" : " none"}" style="margin-bottom:16px">${card ? `<span class="rx-card-brand">${esc(String(card.brand || "card").toUpperCase())}</span>${esc(rxCardLabel(card))}${rx.row.cardholder_name ? ` <small>· ${esc(rx.row.cardholder_name)}</small>` : ""}` : "No card saved yet. Send a payment request: when the guest pays, their card is saved for later charges."}</div>
        <h3 class="rx-h">Payment history</h3>
        <div id="rxTxns">${rxTxnTable()}</div>
      </section>

      <section data-pane="notes"${rx.tab === "notes" ? "" : " hidden"}>
        <div class="field"><label for="rx-staffNotes">Internal notes</label><textarea class="textarea" id="rx-staffNotes" data-rx-field="staffNotes" style="min-height:160px" placeholder="Only your team sees these — never emailed to the guest">${esc(f.staffNotes)}</textarea></div>
        <p class="hint">Guest comments live on the Details tab and appear on confirmations.</p>
      </section>
    </div>

    <aside class="rx-summary" aria-live="polite">
      <h3 class="rx-h">Booking summary</h3>
      <div id="rxSummary"></div>
      ${isNew || rx.readOnly ? "" : `
      <div class="rx-actions">
        <button class="btn rx-btn-pay" type="button" data-rx="panel" data-panel="charge">Process payment</button>
        <button class="btn rx-btn-dark" type="button" data-rx="panel" data-panel="request">Send payment request</button>
        <button class="btn btn-ghost" type="button" data-rx="panel" data-panel="record">Record payment</button>
      </div>
      <div id="rxPanel"></div>`}
    </aside>
  </div>
</div>`,
    foot: `
      <div class="rx-foot-left">
        ${isNew || rx.readOnly ? "" : (rx.confirmCancel
          ? `<span class="rx-confirm">Cancel this booking? <button class="btn btn-danger btn-xs" type="button" data-rx="cancel-yes">Cancel booking</button> <button class="btn btn-ghost btn-xs" type="button" data-rx="cancel-no">Keep it</button></span>`
          : `<button class="rx-link danger" type="button" data-rx="cancel">✕ Cancel booking</button>`)}
        ${isNew ? "" : `<button class="rx-link" type="button" data-rx="print">Print</button>
        <button class="rx-link" type="button" data-rx="email">Email confirmation</button>`}
      </div>
      <select class="select rx-status" data-rx-field="status" aria-label="Booking status"${dis}>${rxOptions(RX_STATUSES, f.status)}</select>
      <button class="btn btn-ghost btn-sm" data-close type="button">Close</button>
      ${rx.readOnly ? "" : `<button class="btn btn-primary btn-sm" type="button" data-rx="save">${isNew ? "Create reservation" : "Save"}</button>`}`
  });
  rxRefresh();
  if (rx.panel) rxShowPanel(rx.panel);
}

function rxSourceLabel(s) { return (RX_SOURCES.find(([v]) => v === s) || [s, s || "Direct"])[1]; }
function rxPlanOptions(g, current) {
  const list = [["", "Best available"], ["standard", "Standard rate"]].concat((g.plans || []).map((p) => [p.id, p.name || "Rate plan"]));
  return rxOptions(list, current);
}

/* Update the computed parts (summary, totals, counters) without re-rendering inputs. */
function rxRefresh() {
  if (!rxOpen()) return;
  const f = rx.form;
  const n = rxNights(f.checkIn, f.checkOut);
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set("#rxNightsText", n > 0 ? `${n} night${n > 1 ? "s" : ""}` : "—");
  set("#rxStatusText", (RX_STATUSES.find(([v]) => v === f.status) || ["", f.status])[1]);
  const st = $("#rxStatusText"); if (st) st.className = "rx-st-" + f.status;
  const s = rxSummaryNumbers();
  set("#rxRoomOut", s ? money(s.room) : "—");
  set("#rxExtraOut", s ? money(s.extraPerson) : "—");
  const box = $("#rxSummary");
  if (!box) return;
  if (!s) { box.innerHTML = `<p class="hint">${esc(rx.quoteError || "Pick dates and a room to see the price.")}</p>`; return; }
  const due = Math.round((s.total - s.received) * 100) / 100;
  const line = (label, value, cls = "") => `<div class="rx-line ${cls}"><span>${label}</span><b>${value}</b></div>`;
  box.innerHTML =
    (rx.dirtyPrice && rx.base ? `<div class="rx-note">New price — saved when you click Save${rx.row ? ` (was ${money(rx.row.total_cents / 100)})` : ""}</div>` : "") +
    line(`Room total${n > 0 ? ` · ${n} night${n > 1 ? "s" : ""}` : ""}${s.planName ? `<small>${esc(s.planName)}</small>` : ""}`, money(s.room)) +
    line("Extra person total", money(s.extraPerson)) +
    line("Extras total", money(s.extras)) +
    line("Discount total", s.discount ? "−" + money(s.discount) : money(0)) +
    (s.taxLines && s.taxLines.length ? s.taxLines.map((t) => line(esc(t.name), money(t.amount), "rx-sub")).join("") : line("Taxes & fees", money(s.tax))) +
    `<div class="rx-rule"></div>` +
    line("Total", money(s.total), "rx-strong") +
    line("Total received", money(s.received)) +
    `<div class="rx-due ${due > 0.004 ? "owed" : due < -0.004 ? "credit" : "settled"}"><span>${due > 0.004 ? "Total outstanding" : due < -0.004 ? "Credit to guest" : "Paid in full"}</span><b>${money(Math.abs(due))}</b></div>` +
    (s.warnings && s.warnings.length ? `<ul class="rx-warn">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "");
}

/* Numbers for the summary: the fresh quote while pricing has changed,
   otherwise what is stored on the booking. */
function rxSummaryNumbers() {
  const received = rx.row ? (rx.row.paid_cents || 0) / 100 : (rx.base ? rx.base.paid : 0);
  const q = rx.quote;
  if (q && (rx.dirtyPrice || !rx.base)) {
    return { room: q.subtotal_cents / 100, extraPerson: q.extra_person_cents / 100, extras: q.extras_cents / 100, discount: q.discount_cents / 100,
      tax: q.tax_cents / 100, taxLines: (q.tax_lines || []).map((t) => ({ name: t.name, amount: t.amount_cents / 100 })),
      total: q.total_cents / 100, received, planName: q.plan_name || "", warnings: q.warnings || [] };
  }
  if (rx.row) {
    const r = rx.row;
    return { room: r.subtotal_cents / 100, extraPerson: (r.extra_person_cents || 0) / 100, extras: (r.extras_cents || 0) / 100,
      discount: (r.discount_cents || 0) / 100, tax: r.tax_cents / 100, taxLines: null, total: r.total_cents / 100, received,
      planName: r.rate_plan_name || "", warnings: [] };
  }
  if (rx.base) {
    const b = rx.base;
    return { room: b.total, extraPerson: 0, extras: 0, discount: 0, tax: 0, taxLines: null, total: b.total, received, planName: "", warnings: [] };
  }
  return null;
}

function rxTxnTable() {
  if (!rx.txns.length) return `<div class="empty">No payments yet.</div>`;
  return `<div class="table-wrap"><table class="data rx-txn"><thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead><tbody>${
    rx.txns.map((t) => {
      const refundable = t.stripe_payment_intent_id && t.amount_cents > 0 && t.status === "paid";
      return `<tr style="cursor:default"><td style="white-space:nowrap">${esc(new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}</td>
        <td>${esc(t.description || "")}${t.note ? `<small class="rx-txn-note">${esc(t.note)}</small>` : ""}</td>
        <td>${esc(t.method === "card" ? "Card" : t.method || "")}</td>
        <td>${t.status === "paid" ? pill(["paid", "Paid"]) : t.status === "pending" ? pill(["pending", "Pending"]) : t.status === "refunded" ? pill(["neutral", t.amount_cents < 0 ? "Refund" : "Refunded"]) : pill(["cancelled", "Failed"])}</td>
        <td class="num"${t.amount_cents < 0 ? ' style="color:var(--danger)"' : ""}>${t.amount_cents < 0 ? "−" : ""}${money(Math.abs(t.amount_cents) / 100)}</td>
        <td style="text-align:right">${refundable ? `<button class="btn btn-ghost btn-xs" type="button" data-rx="refund" data-txn="${esc(t.id)}" data-amount="${t.amount_cents}">Refund</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
}

/* ---------------------------------------------------------------- pricing */
function rxQueue() {
  clearTimeout(rxQuoteTimer);
  rxQuoteTimer = setTimeout(rxRequote, 260);
}
async function rxRequote() {
  if (!rxOpen()) return;
  const f = rx.form;
  const room = roomByCode(f.roomCode);
  if (!room || !f.checkIn || !f.checkOut || rxNights(f.checkIn, f.checkOut) < 1) {
    rx.quote = null; rx.quoteError = "Check-out must be after check-in, and pick a room."; rxRefresh(); return;
  }
  const seq = ++rxQuoteSeq;
  try {
    const q = rxLive()
      ? await SHDB.staffQuote({
          p_room: room.id, p_check_in: f.checkIn, p_check_out: f.checkOut,
          p_adults: Math.max(1, parseInt(f.adults, 10) || 1), p_children: Math.max(0, parseInt(f.children, 10) || 0),
          p_addon_ids: [...rx.addonIds], p_plan: f.plan || null, p_discount_cents: rxCents(f.discount),
          p_reservation: rx.row ? rx.row.id : null, p_keep_rates: !!(rx.row && f.keepRates)
        })
      : rxLocalQuote();
    if (seq !== rxQuoteSeq || !rxOpen()) return;
    if (q && q.error) { rx.quote = null; rx.quoteError = q.message || "This stay cannot be priced."; }
    else { rx.quote = q; rx.quoteError = ""; }
  } catch (e) {
    if (seq !== rxQuoteSeq) return;
    rx.quote = null; rx.quoteError = e.message || "Could not price this stay.";
  }
  rxRefresh();
}

/* Demo mode: same shape as staff_quote, from the sample rates in app.js. */
function rxLocalQuote() {
  const f = rx.form;
  const room = roomByCode(f.roomCode);
  const type = typeOfRoom(room);
  const n = rxNights(f.checkIn, f.checkOut);
  let room$ = 0;
  for (let i = 0; i < n; i++) { const d = new Date(f.checkIn + "T12:00:00"); d.setDate(d.getDate() + i); room$ += rateFor(room, isoLocal(d)); }
  room$ = Math.round(room$ * 100) / 100;
  const guests = (parseInt(f.adults, 10) || 1) + (parseInt(f.children, 10) || 0);
  const tn = type ? normalizeRoomType(type) : null;
  const extraPerson = tn && tn.extraAdultRate ? Math.max(0, guests - tn.includedAdults) * tn.extraAdultRate * n : 0;
  const extras = addons.filter((a) => rx.addonIds.has(a.id || a.name))
    .reduce((s, a) => s + a.price * (a.per === "night" ? n : a.per === "person" ? guests : 1), 0);
  const discount = Math.min(room$, Math.max(0, Number(f.discount) || 0));
  const taxLines = taxes.filter((t) => t.on).map((t) => ({
    name: t.name,
    amount_cents: Math.round((t.kind === "percent" ? ((/Room only/i.test(t.applies || "") ? room$ - discount : room$ - discount + extras + extraPerson) * t.value / 100) : t.value * n) * 100)
  }));
  const tax = taxLines.reduce((s, t) => s + t.amount_cents, 0);
  const total = rxCents(room$ - discount + extras + extraPerson) + tax;
  return { subtotal_cents: rxCents(room$), extra_person_cents: rxCents(extraPerson), extras_cents: rxCents(extras), discount_cents: rxCents(discount),
    tax_cents: tax, tax_lines: taxLines, total_cents: total, plan_name: "", warnings: [] };
}

/* ---------------------------------------------------------------- inputs */
function rxReadField(el) {
  const key = el.dataset.rxField;
  if (key === "addon") {
    if (el.checked) rx.addonIds.add(el.value); else rx.addonIds.delete(el.value);
  } else if (el.type === "checkbox") {
    rx.form[key] = el.checked;
  } else {
    rx.form[key] = el.value;
  }
  return key;
}
function rxOnField(e) {
  const el = e.target.closest("#modal [data-rx-field]");
  if (!el || !rxOpen()) return;
  const key = rxReadField(el);
  if (key === "typeId") {
    const g = rxGroup(rx.form.typeId);
    rx.form.roomCode = g.units[0] ? g.units[0].code : "";
    rx.form.plan = rx.base ? "standard" : "";
    const roomSel = $("#rx-roomCode"), planSel = $("#rx-plan");
    if (roomSel) roomSel.innerHTML = rxOptions(g.units.map((u) => [u.code, `${u.code} · ${u.name}`]), rx.form.roomCode);
    if (planSel) planSel.innerHTML = rxPlanOptions(g, rx.form.plan);
  }
  if (key === "checkIn" && rx.form.checkOut <= rx.form.checkIn) {
    const d = new Date(rx.form.checkIn + "T12:00:00"); d.setDate(d.getDate() + 1);
    rx.form.checkOut = isoLocal(d);
    const out = $("#rx-checkOut"); if (out) out.value = rx.form.checkOut;
  }
  if (RX_PRICE_FIELDS.includes(key)) { rx.dirtyPrice = true; rxQueue(); }
  rxRefresh();
}
document.addEventListener("input", rxOnField);
document.addEventListener("change", rxOnField);

/* ---------------------------------------------------------------- payment panels */
function rxOutstanding() {
  const s = rxSummaryNumbers();
  return s ? Math.max(0, Math.round((s.total - s.received) * 100) / 100) : 0;
}
function rxShowPanel(kind, extra = {}) {
  rx.panel = kind;
  const box = $("#rxPanel");
  if (!box) return;
  $$("#modal [data-rx='panel']").forEach((b) => b.classList.toggle("on", b.dataset.panel === kind));
  if (!kind) { box.innerHTML = ""; return; }
  const due = rxOutstanding();
  const row = rx.row || {};
  const card = row.card_last4 ? { brand: row.card_brand, last4: row.card_last4, expMonth: row.card_exp_month, expYear: row.card_exp_year } : null;
  const amount = (id, value) => `<div class="field"><label for="${id}">Amount ($)</label><input class="input mono" type="number" min="0.01" step="0.01" id="${id}" value="${value.toFixed(2)}"></div>`;
  const live = rxLive();
  if (kind === "charge") {
    box.innerHTML = card && live
      ? `<div class="rx-panel"><p class="rx-panel-h">Charge the card on file</p><p class="rx-panel-sub">${esc(rxCardLabel(card))}</p>
          ${amount("rxChargeAmt", due)}
          <button class="btn rx-btn-pay" type="button" data-rx="charge-go"${due <= 0 ? " disabled" : ""}>Charge card</button>
          <p class="rx-fine">Charged now through Stripe and paid out to your bank. The guest gets an email receipt.</p></div>`
      : `<div class="rx-panel"><p class="rx-panel-h">No card on file</p><p class="rx-panel-sub">${live ? "Cards are saved when a guest books online or pays a payment request. Send a payment request instead — the guest pays online, and their card is saved for later charges." : "Demo property — sign in to your own property to take real card payments."}</p>
          ${live ? `<button class="btn rx-btn-dark" type="button" data-rx="panel" data-panel="request">Send payment request</button>` : ""}</div>`;
  } else if (kind === "request") {
    box.innerHTML = live
      ? `<div class="rx-panel"><p class="rx-panel-h">Payment request</p><p class="rx-panel-sub">A secure Stripe payment page for this booking. Their card is saved for later charges.</p>
          ${amount("rxReqAmt", due)}
          <label class="check-item"><input type="checkbox" id="rxReqEmail"${(rx.form.email || row.guest_email) ? " checked" : " disabled"}><span>${(rx.form.email || row.guest_email) ? `Email the link to ${esc(rx.form.email || row.guest_email)}` : "Add the guest's email to send the link"}</span></label>
          <button class="btn rx-btn-dark" type="button" data-rx="request-go"${due <= 0 ? " disabled" : ""}>Create payment link</button>
          ${extra.url ? `<div class="field" style="margin-top:12px"><label>Payment link (valid 24 hours)</label><div class="rx-copy"><input class="input mono" readonly value="${esc(extra.url)}" id="rxLinkOut"><button class="btn btn-ghost btn-xs" type="button" data-rx="copy-link">Copy</button></div></div>` : ""}</div>`
      : `<div class="rx-panel"><p class="rx-panel-sub">Demo property — sign in to your own property to send payment requests.</p></div>`;
  } else if (kind === "record") {
    box.innerHTML = `<div class="rx-panel"><p class="rx-panel-h">Record a payment</p><p class="rx-panel-sub">For money you already received outside SimpleHotelier — no card is charged.</p>
        ${amount("rxRecAmt", due || 0)}
        <div class="form-2"><div class="field"><label for="rxRecMethod">Method</label><select class="select" id="rxRecMethod">${rxOptions(RX_METHODS.map((m) => [m, m]), "Cash")}</select></div>
        <div class="field"><label for="rxRecNote">Note (optional)</label><input class="input" id="rxRecNote" placeholder="Receipt #, check #…"></div></div>
        <label class="check-item"><input type="checkbox" id="rxRecRefund"><span>Money returned to the guest (records a refund)</span></label>
        <button class="btn btn-primary" type="button" data-rx="record-go">Record payment</button></div>`;
  } else if (kind === "refund") {
    box.innerHTML = `<div class="rx-panel"><p class="rx-panel-h">Refund to card</p><p class="rx-panel-sub">Goes back to the guest's card in 5–10 business days and is taken from your Stripe balance.</p>
        ${amount("rxRefundAmt", (extra.max || 0) / 100)}
        <button class="btn btn-danger" type="button" data-rx="refund-go" data-txn="${esc(extra.txn)}">Refund</button></div>`;
  }
}

function rxAmountFrom(id) {
  const v = Math.round((parseFloat(($(id) || {}).value) || 0) * 100);
  return v > 0 ? v : 0;
}
function rxBusy(on) {
  rx.busy = on;
  $$("#modal [data-rx$='-go'], #modal [data-rx='save']").forEach((b) => { b.disabled = on; });
}

/* Reload the booking after money moved, and reflect it in the lists. */
async function rxReload() {
  if (!rx || !rx.row) return;
  const bundle = await SHDB.reservationBundle(rx.row.id);
  if (!bundle || !rx) return;
  rx.row = bundle.row; rx.txns = bundle.txns;
  if (rx.base) Object.assign(rx.base, bundle.mapped);
  const t = $("#rxTxns"); if (t) t.innerHTML = rxTxnTable();
  rxRefresh();
  renderReservations(); renderFolios(); renderToday();
}

async function rxCharge() {
  const amt = rxAmountFrom("#rxChargeAmt");
  if (!amt) { toast("Enter an amount", "More than $0", "warn"); return; }
  rxBusy(true);
  try {
    await fnInvoke("charge-guest", { action: "charge_card", tenant_id: SHDB.tenantId(), reservation_id: rx.row.id, amount_cents: amt });
    txns.unshift({ when: "Just now", desc: `${rx.row.confirmation_code} · Card charge`, method: "Card", status: "paid", amount: amt / 100 });
    fnInvoke("send-email", { action: "charge_receipt", reservation_id: rx.row.id }).catch(() => {});
    toast(`Charged ${money(amt / 100)}`, rxCardLabel({ brand: rx.row.card_brand, last4: rx.row.card_last4 }), "ok");
    rxShowPanel(null);
    await rxReload(); renderTxns();
  } catch (e) {
    toast("Charge failed", e.message || "Stripe declined the charge", "warn");
  } finally { if (rx) rxBusy(false); }
}
async function rxRequest() {
  const amt = rxAmountFrom("#rxReqAmt");
  if (!amt) { toast("Enter an amount", "More than $0", "warn"); return; }
  rxBusy(true);
  try {
    const d = await fnInvoke("charge-guest", { action: "payment_request", tenant_id: SHDB.tenantId(), reservation_id: rx.row.id, amount_cents: amt, send_email: !!($("#rxReqEmail") && $("#rxReqEmail").checked) });
    toast(d.emailed ? "Payment request sent" : "Payment link ready", d.emailed ? `${money(amt / 100)} · emailed to the guest` : "Copy the link and send it to the guest", "ok");
    rxShowPanel("request", { url: d.url });
  } catch (e) {
    toast("Could not create the payment link", e.message || "Try again", "warn");
  } finally { if (rx) rxBusy(false); }
}
async function rxRecord() {
  const amt = rxAmountFrom("#rxRecAmt");
  if (!amt) { toast("Enter an amount", "More than $0", "warn"); return; }
  const method = $("#rxRecMethod").value, note = $("#rxRecNote").value.trim();
  const signed = $("#rxRecRefund").checked ? -amt : amt;
  if (!rxLive()) { // demo
    rx.base.paid = Math.round((rx.base.paid + signed / 100) * 100) / 100;
    txns.unshift({ when: "Just now", desc: `${rx.base.ref} · ${method}${signed < 0 ? " refund" : ""}`, method, status: signed < 0 ? "refunded" : "paid", amount: signed / 100 });
    toast(signed < 0 ? "Refund recorded" : "Payment recorded", `${money(amt / 100)} · ${method} (demo)`, "ok");
    rxShowPanel(null); rxRefresh(); renderReservations(); renderFolios(); renderTxns();
    return;
  }
  rxBusy(true);
  try {
    await SHDB.recordManualPayment(rx.row.id, signed, method, note);
    txns.unshift({ when: "Just now", desc: `${rx.row.confirmation_code} · ${method}${signed < 0 ? " refund" : ""}`, method, status: signed < 0 ? "refunded" : "paid", amount: signed / 100 });
    toast(signed < 0 ? "Refund recorded" : "Payment recorded", `${money(amt / 100)} · ${method}`, "ok");
    rxShowPanel(null);
    await rxReload(); renderTxns();
  } catch (e) {
    toast("Could not record the payment", e.message || "Try again", "warn");
  } finally { if (rx) rxBusy(false); }
}
async function rxRefund(txnId) {
  const amt = rxAmountFrom("#rxRefundAmt");
  if (!amt) { toast("Enter an amount", "More than $0", "warn"); return; }
  rxBusy(true);
  try {
    await fnInvoke("charge-guest", { action: "refund", tenant_id: SHDB.tenantId(), transaction_id: txnId, amount_cents: amt });
    toast(`Refunded ${money(amt / 100)}`, "Back to the guest's card in 5–10 business days", "ok");
    rxShowPanel(null);
    await rxReload(); renderTxns();
  } catch (e) {
    toast("Refund failed", e.message || "Try again", "warn");
  } finally { if (rx) rxBusy(false); }
}

/* ---------------------------------------------------------------- save / cancel / print / email */
async function rxSave(statusOverride) {
  const f = rx.form;
  if (statusOverride) f.status = statusOverride;
  const name = [f.first.trim(), f.last.trim()].filter(Boolean).join(" ");
  if (!name) { toast("Add the guest's name", "First or last name is required", "warn"); rxTab("details"); return; }
  const room = roomByCode(f.roomCode);
  if (!room) { toast("Pick a room", "Choose a room type and room number", "warn"); return; }
  if (rxNights(f.checkIn, f.checkOut) < 1) { toast("Check your dates", "Check-out must be after check-in", "warn"); return; }
  if (!rxLive()) return rxSaveDemo(name, room);
  rxBusy(true);
  try {
    const { row, mapped } = await SHDB.saveReservation({
      p_reservation: rx.row ? rx.row.id : null, p_room: room.id, p_check_in: f.checkIn, p_check_out: f.checkOut,
      p_guest: { name, email: f.email.trim(), phone: f.phone.trim(), address_line1: f.addr1, address_line2: f.addr2, city: f.city, state: f.state, postcode: f.postcode, country: f.country, arrival_time: f.arrival },
      p_adults: Math.max(1, parseInt(f.adults, 10) || 1), p_children: Math.max(0, parseInt(f.children, 10) || 0), p_infants: Math.max(0, parseInt(f.infants, 10) || 0),
      p_addon_ids: [...rx.addonIds], p_plan: f.plan || null, p_discount_cents: rxCents(f.discount),
      p_keep_rates: !!(rx.row && f.keepRates), p_reprice: !rx.row || rx.dirtyPrice,
      p_status: rxStatusDb(f.status), p_source: f.source, p_notes: f.notes, p_staff_notes: f.staffNotes
    });
    const isNew = !rx.base;
    if (isNew) { reservations.unshift(mapped); rx.base = mapped; }
    else Object.assign(rx.base, mapped);
    rx.row = row; rx.dirtyPrice = false; rx.quote = null; rx.confirmCancel = false;
    rx.form.plan = row.rate_plan_id || "standard";
    renderReservations(); renderToday(); renderFolios(); renderCalendar(); renderMiniRooms();
    toast(isNew ? `Reservation ${row.confirmation_code} created` : `${row.confirmation_code} saved`, `${name} · ${money(row.total_cents / 100)}`, "ok");
    rxRender();
  } catch (e) {
    toast("Could not save", e.message || "Supabase rejected the change", "warn");
  } finally { if (rx) rxBusy(false); }
}
function rxSaveDemo(name, room) {
  const f = rx.form;
  const q = rx.quote || (rx.dirtyPrice || !rx.base ? rxLocalQuote() : null);
  const fields = {
    guest: name, contact: f.email || f.phone || "—", email: f.email, phone: f.phone, room: room.code,
    checkIn: f.checkIn, checkOut: f.checkOut,
    inN: Math.round((new Date(f.checkIn + "T00:00:00") - TODAY) / dayMs), outN: Math.round((new Date(f.checkOut + "T00:00:00") - TODAY) / dayMs),
    status: f.status, source: f.source, notes: f.notes, adults: parseInt(f.adults, 10) || 1
  };
  if (q) fields.total = q.total_cents / 100;
  if (!rx.base) { rx.base = { ref: newRef("R-"), paid: 0, total: 0, ...fields }; reservations.unshift(rx.base); }
  else Object.assign(rx.base, fields);
  rx.dirtyPrice = false; rx.quote = null; rx.confirmCancel = false;
  renderReservations(); renderToday(); renderFolios(); renderCalendar(); renderMiniRooms();
  toast(`${rx.base.ref} saved`, `${name} · demo data, this browser only`, "ok");
  rxRender();
}
function rxTab(tab) {
  rx.tab = tab;
  $$("#modal .rx-tabs [data-tab]").forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); });
  $$("#modal [data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== tab; });
}
function rxPrint() {
  const f = rx.form, s = rxSummaryNumbers() || {};
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups to print", "Your browser blocked the print window", "warn"); return; }
  const prop = tenantDisplayName || (liveTenant && liveTenant.name) || "Your property";
  const row = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(rx.base.ref)} · ${esc(prop)}</title>
    <style>body{font:14px/1.5 system-ui,sans-serif;color:#101f1e;margin:32px}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 18px;color:#5d6f6b}table{border-collapse:collapse;width:100%;max-width:560px}td{padding:6px 0;border-bottom:1px solid #e8eeec}td:last-child{text-align:right;font-weight:600}</style>
    <h1>${esc(prop)} · Booking ${esc(rx.base.ref)}</h1><p>Printed ${esc(new Date().toLocaleString())}</p>
    <table>${row("Guest", [f.first, f.last].filter(Boolean).join(" "))}${row("Email", f.email)}${row("Phone", f.phone)}
    ${row("Check-in", f.checkIn)}${row("Check-out", f.checkOut)}${row("Room", f.roomCode)}${row("Guests", `${f.adults} adults, ${f.children} children, ${f.infants} infants`)}
    ${row("Status", (RX_STATUSES.find(([v]) => v === f.status) || ["", f.status])[1])}
    ${row("Room total", money(s.room || 0))}${row("Extra person", money(s.extraPerson || 0))}${row("Extras", money(s.extras || 0))}${row("Discount", money(s.discount || 0))}${row("Taxes & fees", money(s.tax || 0))}
    ${row("Total", money(s.total || 0))}${row("Received", money(s.received || 0))}${row("Outstanding", money(Math.max(0, (s.total || 0) - (s.received || 0))))}</table>
    ${f.notes ? `<p style="margin-top:18px"><strong>Guest comments:</strong> ${esc(f.notes)}</p>` : ""}`);
  w.document.close();
  w.focus();
  w.print();
}
async function rxEmail() {
  if (!rxLive() || !rx.row) { toast("Demo property", "Sign in to email real guests", "warn"); return; }
  if (!rx.row.guest_email) { toast("No guest email", "Add an email on the Details tab and save first", "warn"); return; }
  try {
    const d = await fnInvoke("send-email", { action: "booking_confirmation", reservation_id: rx.row.id, force: true });
    toast(d.sent ? "Confirmation emailed" : "Email not sent", d.sent ? rx.row.guest_email : (d.reason || "Email is not configured"), d.sent ? "ok" : "warn");
  } catch (e) { toast("Email not sent", e.message || "Try again", "warn"); }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("#modal [data-rx]");
  if (!el || !rxOpen() || el.disabled) return;
  const a = el.dataset.rx;
  if (a === "tab") rxTab(el.dataset.tab);
  else if (a === "panel") rxShowPanel(rx.panel === el.dataset.panel ? null : el.dataset.panel);
  else if (a === "charge-go") rxCharge();
  else if (a === "request-go") rxRequest();
  else if (a === "record-go") rxRecord();
  else if (a === "refund") { rxTab(rx.tab); rxShowPanel("refund", { txn: el.dataset.txn, max: Number(el.dataset.amount) || 0 }); $("#rxPanel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  else if (a === "refund-go") rxRefund(el.dataset.txn);
  else if (a === "copy-link") { const i = $("#rxLinkOut"); if (i) { i.select(); navigator.clipboard?.writeText(i.value).catch(() => {}); toast("Link copied", "Paste it into a text or email to the guest", "ok"); } }
  else if (a === "save") rxSave();
  else if (a === "cancel") { rx.confirmCancel = true; rxRender(); }
  else if (a === "cancel-no") { rx.confirmCancel = false; rxRender(); }
  else if (a === "cancel-yes") rxSave("cancelled");
  else if (a === "print") rxPrint();
  else if (a === "email") rxEmail();
});

/* Pick a booking first (Payments page buttons), then open its editor on a panel. */
function openReservationPicker(panel) {
  const open = reservations.filter((r) => balance(r) > 0 && r.status !== "cancelled");
  if (!open.length) { toast("No open balances", "Every booking is paid", "ok"); return; }
  openModal({
    title: panel === "record" ? "Record a payment" : "Take a payment", sub: "Choose the booking",
    body: `<div class="field"><label for="rxPick">Booking</label><select class="select" id="rxPick">${open.map((r) => `<option value="${esc(r.ref)}">${esc(r.ref)} · ${esc(r.guest)} · ${money(balance(r))} due</option>`).join("")}</select></div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" type="button" data-action="rx-pick" data-panel="${esc(panel)}">Continue</button>`
  });
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action='rx-pick']");
  if (!el) return;
  const ref = ($("#rxPick") || {}).value;
  if (ref) openReservationEditor(ref, { tab: "details", panel: el.dataset.panel });
});
