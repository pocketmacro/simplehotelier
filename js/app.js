/* SimpleHotelier — interactive prototype (demo data, no backend) */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- Demo data ---------------- */
const TODAY = new Date(2026, 9, 26); // Mon Oct 26 2026, matches topbar
const dayMs = 864e5;
const dstr = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const addDays = (n) => new Date(TODAY.getTime() + n * dayMs);

const rooms = [
  { code: "A1", name: "Aspen Loft", type: "Loft · Sleeps 4", rate: 189, status: "reserved", hk: "dirty", note: "Checkout 11 AM · arrival 3 PM" },
  { code: "A2", name: "Birch Cabin", type: "Cabin · Sleeps 6", rate: 249, status: "occupied", hk: "clean", guest: "Daniel Okafor", note: "In-house · departs Oct 28" },
  { code: "A3", name: "Cedar Suite", type: "Suite · Sleeps 2", rate: 159, status: "occupied", hk: "clean", guest: "Priya Nair", note: "In-house · departs Oct 27" },
  { code: "B1", name: "Dogwood Cabin", type: "Cabin · Sleeps 5", rate: 219, status: "occupied", hk: "progress", guest: "Sam Whitaker", note: "Stayover service requested" },
  { code: "B2", name: "Elm Retreat", type: "Cabin · Sleeps 4", rate: 199, status: "vacant", hk: "clean", note: "Next arrival Oct 30" },
  { code: "B3", name: "Fern Hollow", type: "Cabin · Sleeps 6", rate: 259, status: "occupied", hk: "clean", guest: "Lucia Fernandez", note: "In-house · departs Oct 29" },
  { code: "C1", name: "Grove House", type: "House · Sleeps 8", rate: 329, status: "reserved", hk: "dirty", note: "Checkout 11 AM · arrival 4 PM" },
  { code: "C2", name: "Hemlock Hideout", type: "Cabin · Sleeps 2", rate: 149, status: "vacant", hk: "dirty", note: "Deep clean scheduled" },
];
rooms.forEach((r) => {
  const m = String(r.type || "").match(/Sleeps (\d+)/);
  r.sleeps = m ? +m[1] : 2;
  r.typeName = String(r.type || "Cabin").split("·")[0].trim();
  r.photos = r.photos || [];
});
let roomTypes = [
  { id: "demo-cabin", name: "Cabin", desc: "Standalone cabin" },
  { id: "demo-suite", name: "Suite", desc: "Suite in the main lodge" },
  { id: "demo-loft", name: "Loft", desc: "Upper loft unit" },
  { id: "demo-house", name: "House", desc: "Full vacation house" }
];
/* Per-date rate overrides: "CODE|YYYY-MM-DD" -> nightly USD. No entry = default rate. */
let rateOverrides = { "A2|2026-11-06": 299, "A2|2026-11-07": 299, "C1|2026-12-24": 449, "C1|2026-12-25": 449, "C1|2026-12-26": 449 };
let ratesRoomCode = null, ratesMonthOff = 0;
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rateFor(room, iso) { const v = rateOverrides[room.code + "|" + iso]; return v != null ? v : room.rate; }
function nightlySum(room, inISO, outISO) {
  let s = 0; const d = new Date(inISO + "T12:00:00"); const end = new Date(outISO + "T12:00:00");
  while (d < end) { s += rateFor(room, isoLocal(d)); d.setDate(d.getDate() + 1); }
  return Math.round(s * 100) / 100;
}
function syncRoomType(r) { r.type = (r.typeName ? r.typeName + " · " : "") + "Sleeps " + (r.sleeps || 2); }

const reservations = [
  { ref: "R-1042", guest: "Daniel Okafor", contact: "d.okafor@mail.com", room: "A2", inN: -2, outN: 2, status: "checked-in", total: 872.40, paid: 386.20 },
  { ref: "R-1043", guest: "Priya Nair", contact: "(970) 555-0182", room: "A3", inN: -1, outN: 1, status: "checked-in", total: 402.10, paid: 402.10 },
  { ref: "R-1044", guest: "Sam Whitaker", contact: "sam.w@mail.com", room: "B1", inN: -3, outN: 3, status: "checked-in", total: 1244.55, paid: 900.00 },
  { ref: "R-1045", guest: "Lucia Fernandez", contact: "(970) 555-0119", room: "B3", inN: -1, outN: 3, status: "checked-in", total: 1102.30, paid: 1102.30 },
  { ref: "R-1046", guest: "Tom Becker", contact: "tom.b@mail.com", room: "A1", inN: 0, outN: 3, status: "confirmed", total: 640.75, paid: 200.00 },
  { ref: "R-1047", guest: "Aisha Khan", contact: "(970) 555-0144", room: "C1", inN: 0, outN: 2, status: "confirmed", total: 715.90, paid: 0 },
  { ref: "R-1048", guest: "Greg Poulsen", contact: "greg.p@mail.com", room: "B2", inN: 4, outN: 7, status: "pending", total: 655.20, paid: 0 },
  { ref: "R-1049", guest: "Nina Rossi", contact: "nina.r@mail.com", room: "C2", inN: 4, outN: 6, status: "pending", total: 348.60, paid: 0 },
  { ref: "R-1050", guest: "Carl Jensen", contact: "(970) 555-0190", room: "A3", inN: 2, outN: 5, status: "confirmed", total: 521.40, paid: 521.40 },
  { ref: "R-1051", guest: "Marta Silva", contact: "marta.s@mail.com", room: "B2", inN: 8, outN: 11, status: "confirmed", total: 690.00, paid: 150.00 },
  { ref: "R-1052", guest: "Jonah Lee", contact: "jonah.l@mail.com", room: "A1", inN: -6, outN: 0, status: "checked-out", total: 1180.00, paid: 1180.00 },
  { ref: "R-1039", guest: "Emily Zhang", contact: "emily.z@mail.com", room: "C2", inN: -9, outN: -7, status: "cancelled", total: 310.00, paid: 0 },
];

let addons = [
  { name: "Firewood bundle", price: 18, per: "stay", on: true, desc: "Large bundle + starters, stacked at the pit" },
  { name: "Breakfast basket", price: 32, per: "person", on: true, desc: "Local eggs, bread, coffee — serves one" },
  { name: "Late checkout (1 PM)", price: 45, per: "stay", on: true, desc: "Subject to availability" },
  { name: "Pet fee", price: 60, per: "stay", on: true, desc: "Up to 2 dogs · bowls + blanket included" },
  { name: "Hot tub soak kit", price: 25, per: "stay", on: true, desc: "Towels, salts, cedar tray" },
  { name: "Extra cot", price: 20, per: "night", on: false, desc: "Made up before arrival" },
];

let taxes = [
  { name: "State lodging tax", kind: "percent", value: 6.5, applies: "Room + add-ons", on: true },
  { name: "County tourism assessment", kind: "night", value: 2.5, applies: "Per night", on: true },
  { name: "Community district fee", kind: "percent", value: 1.5, applies: "Room only", on: true },
];

const txns = [
  { when: "Today · 9:41 AM", desc: "R-1043 · Balance · Priya Nair", method: "Visa **** 8810", status: "paid", amount: 202.10 },
  { when: "Today · 8:15 AM", desc: "R-1044 · Partial · Sam Whitaker", method: "Amex **** 1005", status: "paid", amount: 400.00 },
  { when: "Yesterday", desc: "R-1050 · Full stay · Carl Jensen", method: "MC **** 5521", status: "paid", amount: 521.40 },
  { when: "Yesterday", desc: "R-1042 · Deposit · Daniel Okafor", method: "Visa **** 3098", status: "paid", amount: 386.20 },
  { when: "Oct 24", desc: "R-1039 · Refund · Emily Zhang", method: "Visa **** 7712", status: "refunded", amount: -155.00 },
];

/* ---------------- Toasts ---------------- */
function toast(title, sub = "", kind = "") {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = `<div>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 250); }, 3400);
}

/* ---------------- Custom modal module (never native alert/confirm) ---------------- */
const overlay = $("#overlay"), modal = $("#modal");
function openModal({ title, sub = "", body = "", foot = "", wide = false }) {
  modal.classList.toggle("wide", !!wide);
  modal.innerHTML = `
    <div class="modal-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
    <button class="modal-x" data-close type="button" aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ""}`;
  overlay.classList.add("open");
}
function closeModal() { overlay.classList.remove("open"); }
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

/* ---------------- Navigation ---------------- */
function goto(view) {
  $$("#mainNav .nav-btn, .nav .nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "rates") renderRates();
  document.body.classList.remove("nav-open");
  window.scrollTo({ top: 0 });
}
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-view]");
  if (nav) { goto(nav.dataset.view); return; }
  const go = e.target.closest("[data-goto]");
  if (go) goto(go.dataset.goto);
});
/* Setup checklist: completed items stay editable — click (or Enter) reopens the setting. */
function openChecklistRow(row) {
  if (!row) return;
  if (row.dataset.goto) { goto(row.dataset.goto); return; }
  if (row.dataset.focus) {
    const el = document.querySelector(row.dataset.focus);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => el.focus({ preventScroll: true }), 250); }
  }
}
document.addEventListener("click", (e) => {
  const row = e.target.closest(".check[data-focus]");
  if (row) openChecklistRow(row);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const row = e.target.closest ? e.target.closest(".check[role='button']") : null;
  if (row) openChecklistRow(row);
});
$("#menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));

/* ---------------- Status helpers ---------------- */
const HK = { clean: ["clean", "Clean"], dirty: ["dirty", "Dirty"], progress: ["progress", "In progress"] };
const ST = {
  "checked-in": ["checked-in", "In-house"], confirmed: ["confirmed", "Confirmed"],
  pending: ["pending", "Pending"], "checked-out": ["neutral", "Checked out"], cancelled: ["cancelled", "Cancelled"],
};
const RSTAT = { occupied: ["occupied", "Occupied"], reserved: ["reserved", "Reserved"], vacant: ["vacant", "Vacant"] };
const pill = ([cls, label]) => `<span class="pill ${cls}"><i></i>${label}</span>`;
const resDates = (r) => `${dstr(addDays(r.inN))} → ${dstr(addDays(r.outN))}`;
const roomByCode = (c) => rooms.find((r) => r.code === c);
const balance = (r) => Math.max(0, r.total - r.paid);

/* ---------------- Overview ---------------- */
function renderToday() {
  const arr = reservations.filter((r) => r.inN === 0 && r.status !== "cancelled");
  const dep = reservations.filter((r) => r.outN === 0 && r.status !== "cancelled");
  const item = (r, tag) => `
    <div class="row-item"><span class="room-code">${esc(r.room)}</span>
      <div class="ri-main"><strong>${esc(r.guest)} · ${tag}</strong><span>${esc(resDates(r))} · ${money(r.total)}</span></div>
      <div class="ri-right">${pill(ST[r.status] || ST.confirmed)}</div></div>`;
  $("#todayList").innerHTML =
    arr.map((r) => item(r, "Arriving")).join("") + dep.map((r) => item(r, "Departing")).join("") ||
    `<div class="empty">No movement today.</div>`;
}

function renderMiniRooms() {
  $("#miniRooms").innerHTML = rooms.map((r) => `
    <div style="border:1px solid var(--line);border-radius:10px;padding:10px 11px;background:var(--surface-2)">
      <div style="display:flex;align-items:center;gap:7px"><strong style="color:var(--ink);font-size:13px">${r.code}</strong>${pill(RSTAT[r.status])}</div>
      <div style="margin-top:6px">${pill(HK[r.hk])}</div>
    </div>`).join("");
}

/* ---------------- Reservations ---------------- */
let resFilter = "all", resQuery = "";
function resMatches(r) {
  if (resFilter === "arriving" && r.inN !== 0) return false;
  if (resFilter === "in-house" && r.status !== "checked-in") return false;
  if (resFilter === "pending" && r.status !== "pending") return false;
  if (resFilter === "balance" && balance(r) <= 0) return false;
  if (resQuery && !(r.guest + r.ref + r.room).toLowerCase().includes(resQuery)) return false;
  return true;
}
function renderReservations() {
  const rows = reservations.filter(resMatches).map((r) => `
    <tr data-ref="${r.ref}">
      <td class="guest"><strong>${esc(r.guest)}</strong><span>${esc(r.contact)}</span></td>
      <td class="mono">${r.ref}</td>
      <td><span class="room-code">${esc(r.room)}</span></td>
      <td style="white-space:nowrap">${esc(resDates(r))}</td>
      <td>${pill(ST[r.status])}</td>
      <td class="num">${money(r.total)}</td>
      <td class="num" style="${balance(r) > 0 ? "color:var(--danger)" : "color:var(--success)"}">${money(balance(r))}</td>
      <td style="white-space:nowrap;text-align:right">
        ${balance(r) > 0 ? `<button class="btn btn-ghost btn-xs" data-action="charge" data-ref="${r.ref}" type="button">Charge</button>` : ""}
        <button class="btn btn-ghost btn-xs" data-action="res-detail" data-ref="${r.ref}" type="button">Open</button>
      </td>
    </tr>`).join("");
  $("#resTable tbody").innerHTML = rows || `<tr><td colspan="8"><div class="empty">No reservations match this filter.</div></td></tr>`;
}
$("#resFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  resFilter = b.dataset.f;
  $$("#resFilter button").forEach((x) => x.classList.toggle("active", x === b));
  renderReservations();
});
$("#resSearch").addEventListener("input", (e) => { resQuery = e.target.value.trim().toLowerCase(); renderReservations(); });
$("#resTable").addEventListener("click", (e) => {
  if (e.target.closest("[data-action]")) return;
  const tr = e.target.closest("tr[data-ref]");
  if (tr) openResDetail(tr.dataset.ref);
});

/* ---------------- Calendar ---------------- */
let calOffset = 0;
function renderCalendar() {
  const grid = $("#calGrid");
  const days = [...Array(14)].map((_, i) => addDays(calOffset + i));
  let html = `<div class="cal-head"><div>${dstr(days[0])} – ${dstr(days[13])}</div>` +
    days.map((d, i) => `<div style="${i === -calOffset ? "color:var(--brand);font-weight:800" : ""}">${d.toLocaleDateString("en-US", { weekday: "short" })}<br>${d.getMonth() + 1}/${d.getDate()}</div>`).join("") + `</div>`;
  // Deterministic demo stays per room (offsets relative to today)
  const demo = { A1: [[0, 3, "Tom Becker", "confirmed"], [8, 11, "Marta Silva", "pending"]], A2: [[-2, 2, "Daniel Okafor", "checkedin"]], A3: [[-1, 1, "Priya Nair", "checkedin"], [2, 5, "Carl Jensen", "confirmed"]], B1: [[-3, 3, "Sam Whitaker", "checkedin"]], B2: [[4, 7, "Greg Poulsen", "pending"], [8, 11, "Marta Silva", "confirmed"]], B3: [[-1, 3, "Lucia Fernandez", "checkedin"]], C1: [[0, 2, "Aisha Khan", "confirmed"]], C2: [[4, 6, "Nina Rossi", "pending"]] };
  rooms.forEach((r) => {
    html += `<div class="cal-row"><div class="cal-room"><strong>${r.code} · ${esc(r.name)}</strong><span>${esc(r.type)}</span></div>`;
    days.forEach((d, i) => {
      const n = calOffset + i;
      const isToday = n === 0;
      const stay = (demo[r.code] || []).find(([s, e]) => n >= s && n < e);
      const blocked = r.code === "C2" && n >= 11 && n < 13;
      let inner = "";
      if (stay && n === stay[0]) inner = `<div class="stay s-${stay[3]}" data-action="res-detail" data-ref="${stay[2]}">${esc(stay[2])}<small>${dstr(addDays(stay[0]))} → ${dstr(addDays(stay[1]))}</small></div>`;
      else if (stay) inner = `<div class="stay s-${stay[3]}" style="opacity:.45">&nbsp;<small>&nbsp;</small></div>`;
      else if (blocked) inner = `<div class="stay-blocked"></div>`;
      html += `<div class="cal-cell${isToday ? " today" : ""}">${inner}</div>`;
    });
    html += `</div>`;
  });
  grid.innerHTML = html;
}
$("#calPrev").addEventListener("click", () => { calOffset -= 14; renderCalendar(); });
$("#calNext").addEventListener("click", () => { calOffset += 14; renderCalendar(); });
$("#calToday").addEventListener("click", () => { calOffset = 0; renderCalendar(); });

/* ---------------- Rooms + housekeeping ---------------- */
function renderRooms() {
  $("#roomGrid").innerHTML = rooms.map((r) => `
    <div class="card room-card">
      ${r.photos && r.photos.length ? `<img class="room-cover" src="${esc(r.photos[0])}" alt="${esc(r.name)}">` : ""}
      <div class="room-top"><div><h3>${r.code} · ${esc(r.name)}</h3><div class="meta">${esc(r.type)}</div></div>
        <div class="room-rate"><strong>${money(r.rate)}</strong><span>/ night</span></div></div>
      <div class="room-flags">${pill(RSTAT[r.status])}${pill(HK[r.hk])}${r.guest ? `<span class="tag">${esc(r.guest)}</span>` : ""}</div>
      <div style="font-size:12.5px;color:var(--muted)">${esc(r.note)}</div>
      <div class="room-actions">
        <button class="hk-btn${r.hk === "dirty" ? " on-dirty" : ""}" data-hk="${r.code}|dirty" type="button">Dirty</button>
        <button class="hk-btn${r.hk === "progress" ? " on-progress" : ""}" data-hk="${r.code}|progress" type="button">In progress</button>
        <button class="hk-btn${r.hk === "clean" ? " on-clean" : ""}" data-hk="${r.code}|clean" type="button">Clean</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-xs" data-action="edit-room" data-code="${r.code}" type="button" style="flex:1">Edit</button>
        <button class="btn btn-ghost btn-xs" data-action="room-photos" data-code="${r.code}" type="button" style="flex:1">Photos${r.photos && r.photos.length ? " (" + r.photos.length + ")" : ""}</button>
        <button class="btn btn-ghost btn-xs" data-action="room-rates" data-code="${r.code}" type="button" style="flex:1">Rates</button>
      </div>
    </div>`).join("");
}
function renderHK() {
  const cols = [["dirty", "Dirty · needs cleaning"], ["progress", "In progress"], ["clean", "Clean · ready"]];
  $("#hkBoard").innerHTML = cols.map(([key, label]) => {
    const list = rooms.filter((r) => r.hk === key);
    return `<div class="hk-col"><header>${label}<span class="n">${list.length}</span></header>` +
      (list.map((r) => `
        <div class="hk-card"><strong>${r.code} · ${esc(r.name)}</strong><p>${esc(r.note)}</p>
          <div class="hk-move">
            ${key !== "dirty" ? `<button class="btn btn-ghost btn-xs" data-hk="${r.code}|dirty" type="button">← Dirty</button>` : ""}
            ${key === "dirty" ? `<button class="btn btn-primary btn-xs" data-hk="${r.code}|progress" type="button">Start →</button>` : ""}
            ${key === "progress" ? `<button class="btn btn-primary btn-xs" data-hk="${r.code}|clean" type="button">Mark clean ✓</button>` : ""}
            ${key === "clean" ? `<button class="btn btn-ghost btn-xs" data-hk="${r.code}|dirty" type="button">Flag dirty</button>` : ""}
          </div></div>`).join("") || `<div class="empty" style="padding:18px">Nothing here.</div>`) + `</div>`;
  }).join("");
}
const ratePrevBtn = $("#ratePrev"), rateNextBtn = $("#rateNext"), rateTodayBtn2 = $("#rateTodayBtn"), rateRoomSel = $("#rateRoom");
if (ratePrevBtn) ratePrevBtn.addEventListener("click", () => { ratesMonthOff--; renderRates(); });
if (rateNextBtn) rateNextBtn.addEventListener("click", () => { ratesMonthOff++; renderRates(); });
if (rateTodayBtn2) rateTodayBtn2.addEventListener("click", () => { ratesMonthOff = 0; renderRates(); });
if (rateRoomSel) rateRoomSel.addEventListener("change", () => { ratesRoomCode = rateRoomSel.value; renderRates(); });
/* Audit bindings: segmented toggles, property picker, logo upload */
$$(".seg").forEach((seg) => {
  if (seg.id === "resFilter") return;
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $$("button", seg).forEach((x) => x.classList.toggle("active", x === b));
  });
});
const propPickerBtn = $("#propPicker");
if (propPickerBtn) propPickerBtn.addEventListener("click", () => goto("settings"));
const logoFileInput = $("#logoFile");
if (logoFileInput) logoFileInput.addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { toast("Logo too large", "Please use an image under 5 MB", "warn"); return; }
  try {
    let url;
    if (window.SHDB && SHDB.hasLive()) {
      url = await SHDB.uploadPublic("property-logos", `${SHDB.tenantId()}/logo-${Date.now()}.${(f.name.split(".").pop() || "png").toLowerCase()}`, f);
      await SHDB.updateTenantSettings({ logo_url: url });
      toast("Logo saved", "It now appears on your booking page", "ok");
    } else {
      url = URL.createObjectURL(f);
      toast("Logo preview only", "Sign in live to save it to your property", "warn");
    }
    const img = $("#logoPreview");
    img.src = url; img.hidden = false;
    const empty = $("#logoEmpty"); if (empty) empty.style.display = "none";
  } catch { toast("Logo upload failed", "Check the image and try again", "err"); }
});
document.addEventListener("click", (e) => {
  const day = e.target.closest("[data-rate-date]");
  if (day) { openRateDay(day.dataset.rateDate); return; }
  const b = e.target.closest("[data-hk]"); if (!b) return;
  const [code, hk] = b.dataset.hk.split("|");
  const r = roomByCode(code);
  r.hk = hk;
  if (hk === "clean") r.note = r.status === "vacant" ? "Ready for next arrival" : r.note;
  renderRooms(); renderHK(); renderMiniRooms();
  if (window.SHDB) SHDB.updateHK(r);
  toast(`${code} marked ${HK[hk][1].toLowerCase()}`, r.name, hk === "clean" ? "ok" : "");
});

/* ---------------- Room types, editing, rate calendar, photos ---------------- */
function typeRoomCount(t) {
  return rooms.filter((r) => (r.typeId && r.typeId === t.id) || (!r.typeId && r.typeName === t.name)).length;
}
function openRoomTypes(editId) {
  const editing = roomTypes.find((t) => t.id === editId);
  openModal({
    title: "Room types", sub: "Group rooms for booking, rates and reports",
    body: `
      <div class="row-list" style="margin-bottom:14px">
        ${roomTypes.map((t, i) => `
          <div class="row-item"><div class="ri-main"><strong>${esc(t.name)}</strong><span>${esc(t.desc || "No description")}</span></div>
            <div class="ri-right" style="display:flex;gap:6px;align-items:center"><span class="tag">${typeRoomCount(t)} rooms</span>
            <button class="btn btn-ghost btn-xs" data-action="rt-edit" data-i="${i}" type="button">Edit</button>
            <button class="btn btn-ghost btn-xs" data-action="rt-del" data-i="${i}" type="button">Delete</button></div></div>`).join("") || `<p class="hint">No room types yet. Add your first below.</p>`}
      </div>
      <div class="form-2">
        <div class="field"><label>${editing ? "Edit" : "New"} type name</label><input class="input" id="rtName" value="${editing ? esc(editing.name) : ""}" placeholder="e.g. Cabin"></div>
        <div class="field"><label>Description</label><input class="input" id="rtDesc" value="${editing ? esc(editing.desc || "") : ""}" placeholder="Short guest-facing text"></div>
      </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Close</button>
      <button class="btn btn-primary btn-sm" data-action="rt-save" data-edit="${editing ? editing.id : ""}" type="button">${editing ? "Save type" : "Add type"}</button>`,
    wide: true
  });
}
function openEditRoom(code) {
  const r = roomByCode(code);
  if (!r) return;
  const opts = [`<option value="">No type</option>`].concat(roomTypes.map((t) => `<option value="${esc(t.id)}" ${r.typeId === t.id || (!r.typeId && r.typeName === t.name) ? "selected" : ""}>${esc(t.name)}</option>`)).join("");
  openModal({
    title: `Edit ${r.code} · ${r.name}`, sub: "Default rate applies unless a date override is set",
    body: `
      <div class="form-2">
        <div class="field"><label>Name</label><input class="input" id="erName" value="${esc(r.name)}"></div>
        <div class="field"><label>Room type</label><select class="select" id="erType">${opts}</select></div>
      </div>
      <div class="form-3">
        <div class="field"><label>Sleeps</label><input class="input" id="erSleeps" type="number" min="1" value="${r.sleeps || 2}"></div>
        <div class="field"><label>Default rate (USD/night)</label><input class="input mono" id="erRate" type="number" min="0" value="${r.rate}"></div>
        <div class="field"><label>Code</label><input class="input mono" value="${esc(r.code)}" disabled></div>
      </div>
      <div class="field"><label>Notes</label><input class="input" id="erNotes" value="${esc(r.note || "")}" placeholder="Internal note shown on the room card"></div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="save-edit-room" data-code="${r.code}" type="button">Save room</button>`
  });
}
function ratesRoom() {
  if (!ratesRoomCode || !roomByCode(ratesRoomCode)) ratesRoomCode = rooms.length ? rooms[0].code : null;
  return ratesRoomCode ? roomByCode(ratesRoomCode) : null;
}
function renderRates() {
  const sel = $("#rateRoom");
  if (!sel) return;
  const room = ratesRoom();
  sel.innerHTML = rooms.map((r) => `<option value="${r.code}" ${room && r.code === room.code ? "selected" : ""}>${r.code} · ${esc(r.name)} (default ${money(r.rate)})</option>`).join("");
  if (!room) { $("#rateGrid").innerHTML = `<p class="hint">Add a room first.</p>`; return; }
  const base = new Date(TODAY.getFullYear(), TODAY.getMonth() + ratesMonthOff, 1);
  $("#rateMonthLabel").textContent = base.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const year = base.getFullYear(), mon = base.getMonth();
  const first = new Date(year, mon, 1);
  const startBlank = (first.getDay() + 6) % 7;
  const days = new Date(year, mon + 1, 0).getDate();
  const todayIso = isoLocal(TODAY);
  let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="rate-dow">${d}</div>`).join("");
  for (let i = 0; i < startBlank; i++) html += `<div class="rate-day blank"></div>`;
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, mon, d);
    const iso = isoLocal(dt);
    const over = rateOverrides[room.code + "|" + iso] != null;
    html += `<button type="button" class="rate-day${over ? " over" : ""}${iso === todayIso ? " today" : ""}${iso < todayIso ? " past" : ""}" data-rate-date="${iso}">
      <div class="d">${dt.toLocaleDateString("en-US", { weekday: "short" })} ${d}</div>
      <div class="p">${money(rateFor(room, iso))}</div>
      <div class="t">${over ? "Override" : "Default"}</div></button>`;
  }
  $("#rateGrid").innerHTML = html;
}
function openRateDay(iso) {
  const room = ratesRoom();
  if (!room) return;
  const key = room.code + "|" + iso;
  const has = rateOverrides[key] != null;
  const pretty = new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  openModal({
    title: `${room.code} · ${pretty}`, sub: `Default rate ${money(room.rate)} per night`,
    body: `<div class="field"><label>Rate for this date (USD)</label><input class="input mono" id="rdRate" type="number" min="0" value="${has ? rateOverrides[key] : room.rate}"></div>
      <p class="help" style="font-size:12px;color:var(--faint)">${has ? "This date has an override. Clear it to fall back to the default rate." : "Saving creates an override for this date only."}</p>`,
    foot: `${has ? `<button class="btn btn-ghost btn-sm" data-action="rd-clear" data-date="${iso}" type="button">Use default</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="rd-save" data-date="${iso}" type="button">Save rate</button>`
  });
}
function openRoomPhotos(code) {
  const r = roomByCode(code);
  if (!r) return;
  r.photos = r.photos || [];
  openModal({
    title: `Photos · ${r.code} ${r.name}`, sub: "First photo is the cover on your booking page",
    body: `
      <div class="photo-grid">${r.photos.map((p, i) => `<figure><img src="${esc(p)}" alt=""><button type="button" data-action="photo-del" data-code="${r.code}" data-i="${i}" aria-label="Remove photo">✕</button></figure>`).join("") || `<p class="hint">No photos yet. Upload the first below.</p>`}</div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
        <label class="btn btn-primary btn-sm" for="roomPhotoFile" style="cursor:pointer">Upload photos</label>
        <input type="file" id="roomPhotoFile" accept="image/*" multiple hidden>
        <span class="help" style="font-size:12px;color:var(--faint)">JPG or PNG, up to 5 MB each</span>
      </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Done</button>`,
    wide: true
  });
  $("#roomPhotoFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) { toast("Skipped a large photo", f.name + " is over 5 MB", "warn"); continue; }
      try {
        let url;
        if (window.SHDB && SHDB.hasLive() && r.id) {
          url = await SHDB.uploadPublic("room-photos", `${SHDB.tenantId()}/${r.code}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`, f);
        } else {
          url = URL.createObjectURL(f);
          toast("Photo preview only", "Sign in live to save photos to your property", "warn");
        }
        r.photos.push(url);
      } catch { toast("Upload failed", f.name, "err"); }
    }
    if (window.SHDB && r.id) SHDB.updateRoom(r.id, { photos: r.photos }).catch(() => toast("Photos saved locally only", "Storage sync failed", "warn"));
    renderRooms();
    openRoomPhotos(r.code);
  });
}

/* ---------------- Payments ---------------- */
function renderFolios() {
  const open = reservations.filter((r) => balance(r) > 0 && r.status !== "cancelled");
  $("#folioTable tbody").innerHTML = open.map((r) => `
    <tr><td class="guest"><strong>${esc(r.guest)}</strong><span>${esc(r.contact)}</span></td>
      <td class="mono">${r.ref}</td><td><span class="room-code">${esc(r.room)}</span></td>
      <td><span class="tag">Room</span><span class="tag">Taxes</span>${r.ref === "R-1044" ? `<span class="tag">Firewood</span>` : ""}</td>
      <td class="num">${money(r.paid)}</td><td class="num" style="color:var(--danger)">${money(balance(r))}</td>
      <td style="text-align:right"><button class="btn btn-brass btn-xs" data-action="charge" data-ref="${r.ref}" type="button">Charge ${money(balance(r))}</button></td></tr>`).join("") ||
    `<tr><td colspan="7"><div class="empty">All folios settled.</div></td></tr>`;
}
function renderTxns() {
  $("#txnTable tbody").innerHTML = txns.map((t) => `
    <tr style="cursor:default"><td style="white-space:nowrap">${esc(t.when)}</td><td>${esc(t.desc)}</td>
      <td>${esc(t.method)}</td><td>${t.status === "paid" ? pill(["paid", "Paid"]) : pill(["neutral", "Refunded"])}</td>
      <td class="num">${money(t.amount)}</td></tr>`).join("");
}

/* ---------------- Add-ons + taxes ---------------- */
function renderAddons() {
  $("#addonList").innerHTML = addons.map((a, i) => `
    <div class="row-item"><div class="ri-main"><strong>${esc(a.name)} · ${money(a.price)}<span style="color:var(--faint)"> / ${esc(a.per)}</span></strong><span>${esc(a.desc)}</span></div>
      <div class="ri-right" style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost btn-xs" data-action="toggle-addon" data-i="${i}" type="button">${a.on ? "Hide" : "Show"}</button>
        <button class="btn btn-ghost btn-xs" data-action="del-addon" data-i="${i}" type="button">Remove</button>
      </div></div>`).join("");
  const n = addons.filter((a) => a.on).length;
  $("#bkAddonCount").textContent = `${n} add-ons enabled`;
}
function renderTaxes() {
  $("#taxList").innerHTML = taxes.map((t, i) => `
    <div class="row-item"><div class="ri-main"><strong>${esc(t.name)}</strong><span>${t.kind === "percent" ? t.value + "% · " + esc(t.applies) : money(t.value) + " · " + esc(t.applies)}</span></div>
      <div class="ri-right"><button class="btn btn-ghost btn-xs" data-action="del-tax" data-i="${i}" type="button">Remove</button></div></div>`).join("");
  const base = 200;
  let rows = `<dt>Room (1 night)</dt><dd class="mono">${money(base)}</dd>`;
  let total = base;
  taxes.filter((t) => t.on).forEach((t) => {
    const amt = t.kind === "percent" ? base * t.value / 100 : t.value;
    total += amt;
    rows += `<dt>${esc(t.name)}</dt><dd class="mono">${money(amt)}</dd>`;
  });
  rows += `<dt><strong>Guest pays</strong></dt><dd class="mono"><strong>${money(total)}</strong></dd>`;
  $("#taxPreview").innerHTML = rows;
}

/* ---------------- Booking studio ---------------- */
function bookingBase() {
  return location.protocol.startsWith("http") ? location.origin : "https://simplehotelier.pocketmacro.workers.dev";
}
function updateEmbed(tenant) {
  const slug = (tenant && tenant.slug) || "pinecrest";
  const src = bookingBase() + "/book.html?property=" + encodeURIComponent(slug) + "&embed=1";
  const el = $("#bkEmbed");
  if (el) el.value = `<div style="max-width:720px;margin:0 auto"><iframe id="sh-book" src="${src}" style="width:100%;border:0;border-radius:14px;min-height:640px" loading="lazy" title="Book your stay"></iframe></div>\n<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="simplehotelier:height"){var f=document.getElementById("sh-book");if(f)f.style.height=e.data.height+"px"}});<\/script>`;
  const open = $("#bkOpenLink");
  if (open) open.href = bookingBase() + "/book.html?property=" + encodeURIComponent(slug);
}
function renderMockRooms() {
  const imgs = ["linear-gradient(135deg,#285b5c,#0c3b3c)", "linear-gradient(135deg,#7a5a33,#3d2c14)", "linear-gradient(135deg,#3f6b8a,#1f3a5f)"];
  $("#mockRooms").innerHTML = rooms.slice(0, 3).map((r, i) => `
    <div class="mock-room"><div class="img" style="background:${imgs[i % 3]}"></div>
      <div class="bd"><strong>${esc(r.name)}</strong><p>${esc(r.type)} · ★ 4.9</p>
        <div class="pr"><b>${money(r.rate)}<span style="font-weight:500;font-size:11.5px;color:var(--faint)"> /night</span></b><button class="btn btn-primary btn-xs" data-action="mock-search" type="button">Select</button></div></div></div>`).join("");
}
function bindStudio() {
  $("#bkName").addEventListener("input", (e) => { $("#mockName").textContent = (e.target.value || "Your property").toUpperCase() + " · ESTES PARK"; });
  $("#bkHead").addEventListener("input", (e) => { $("#mockHead").textContent = e.target.value; });
  $("#bkSub").addEventListener("input", (e) => { $("#mockSub").textContent = e.target.value; });
  $("#bkUrl").addEventListener("input", (e) => { $("#bkUrlPrev").textContent = e.target.value || "you.simplehotelier.com"; });
  $("#bkColors").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch"); if (!b) return;
    $$("#bkColors .swatch").forEach((s) => s.classList.toggle("sel", s === b));
    document.body.dataset.brand = b.dataset.c;
    $("#mockHero").style.background = `linear-gradient(180deg, ${b.dataset.c}e8, ${b.dataset.c}c2), repeating-linear-gradient(115deg, ${b.dataset.c} 0 26px, rgb(0 0 0 / 22%) 26px 52px)`;
  });
}

/* ---------------- Reports ---------------- */
function renderReports() {
  const data = [["12", 420], ["13", 610], ["14", 380], ["15", 540], ["16", 890], ["17", 1240], ["18", 1180], ["19", 640], ["20", 520], ["21", 610], ["22", 780], ["23", 990], ["24", 1310], ["25", 1090]];
  const max = Math.max(...data.map((d) => d[1]));
  $("#revChart").innerHTML = data.map(([d, v], i) =>
    `<div class="bar" title="Oct ${d} · ${money(v)}"><i style="height:${Math.round(v / max * 100)}%"></i><span>${d}</span></div>`).join("");
  const top = [["B3 · Fern Hollow", 3210], ["C1 · Grove House", 2980], ["B1 · Dogwood Cabin", 2744], ["A2 · Birch Cabin", 2510]];
  const tmax = top[0][1];
  $("#topRooms").innerHTML = top.map(([n, v]) => `
    <div class="row-item"><div class="ri-main" style="flex:1"><strong>${esc(n)}</strong>
      <div class="progress" style="background:var(--surface-3);margin-top:6px"><i style="width:${Math.round(v / tmax * 100)}%;background:var(--brand-2)"></i></div></div>
      <div class="ri-right mono">${money(v)}</div></div>`).join("");
  $("#taxLiability").innerHTML = `
    <dt>State lodging tax (6.5%)</dt><dd class="mono">$1,021.40</dd>
    <dt>Tourism assessment</dt><dd class="mono">$287.50</dd>
    <dt>District fee (1.5%)</dt><dd class="mono">$235.60</dd>
    <dt><strong>Total owed</strong></dt><dd class="mono"><strong>$1,544.50</strong></dd>`;
}

/* ---------------- Modals: reservation detail / new / charge ---------------- */
function openResDetail(ref) {
  const r = reservations.find((x) => x.ref === ref || x.guest === ref);
  if (!r) return;
  const room = roomByCode(r.room);
  openModal({
    title: `${r.ref} · ${r.guest}`, sub: `${resDates(r)} · ${room ? room.name : r.room}`,
    body: `
      <div style="display:flex;gap:8px;margin-bottom:14px">${pill(ST[r.status])}${balance(r) > 0 ? pill(["partial", money(balance(r)) + " due"]) : pill(["paid", "Paid in full"])}</div>
      <div class="kv">
        <dt>Contact</dt><dd>${esc(r.contact)}</dd>
        <dt>Room</dt><dd>${r.room} · ${room ? esc(room.type) : ""} · ${room ? money(room.rate) : ""}/night</dd>
        <dt>Status</dt><dd>${ST[r.status][1]}</dd>
        <dt>Total</dt><dd class="mono">${money(r.total)}</dd>
        <dt>Paid</dt><dd class="mono">${money(r.paid)}</dd>
        <dt>Balance</dt><dd class="mono">${money(balance(r))}</dd>
      </div>`,
    foot: `
      ${r.status === "pending" ? `<button class="btn btn-primary btn-sm" data-action="confirm-res" data-ref="${r.ref}" type="button">Confirm reservation</button>` : ""}
      ${balance(r) > 0 ? `<button class="btn btn-brass btn-sm" data-action="charge" data-ref="${r.ref}" type="button">Charge ${money(balance(r))}</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-close type="button">Close</button>`,
  });
}

function openNewReservation() {
  const roomOpts = rooms.map((r) => `<option value="${r.code}">${r.code} · ${esc(r.name)} — ${money(r.rate)}/nt</option>`).join("");
  openModal({
    title: "New reservation", sub: "Walk-in, phone or manual entry",
    body: `
      <div class="form-2">
        <div class="field"><label>Guest name</label><input class="input" id="nrName" placeholder="Jane Appleseed"></div>
        <div class="field"><label>Contact</label><input class="input" id="nrContact" placeholder="email or phone"></div>
      </div>
      <div class="form-3">
        <div class="field"><label>Room</label><select class="select" id="nrRoom">${roomOpts}</select></div>
        <div class="field"><label>Check-in</label><input class="input" type="date" id="nrIn" value="2026-10-30"></div>
        <div class="field"><label>Check-out</label><input class="input" type="date" id="nrOut" value="2026-11-01"></div>
      </div>
      <div class="field"><label>Add-ons</label><div id="nrAddons" style="display:flex;gap:7px;flex-wrap:wrap">${addons.filter((a) => a.on).map((a) => `<label class="tag" style="cursor:pointer"><input type="checkbox" value="${esc(a.name)}" style="accent-color:var(--brand)"> ${esc(a.name)} · ${money(a.price)}</label>`).join("")}</div></div>
      <div class="field"><label>Notes</label><textarea class="textarea" id="nrNotes" placeholder="Early arrival, crib, allergies…"></textarea></div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="save-reservation" type="button">Create reservation</button>`,
    wide: true,
  });
}

function openCharge(ref) {
  const r = ref ? reservations.find((x) => x.ref === ref) : reservations.find((x) => balance(x) > 0);
  if (!r) { toast("Nothing to charge", "All folios are settled", "ok"); return; }
  const due = balance(r);
  openModal({
    title: `Charge ${r.guest}`, sub: `${r.ref} · ${r.room} · ${roomByCode(r.room)?.name || ""}`,
    body: `
      <div class="charge-total"><span>Balance due</span><strong>${money(due)}</strong></div>
      <div class="form-2">
        <div class="field"><label>Amount</label><input class="input mono" id="chAmt" type="number" min="1" step="0.01" value="${due.toFixed(2)}"></div>
        <div class="field"><label>Method</label><select class="select" id="chMethod"><option>Visa **** 3098 (on file)</option><option>New card…</option><option>Cash</option><option>Bank transfer</option></select></div>
      </div>
      <div class="field"><label>Receipt email</label><input class="input" value="${esc(r.contact.includes("@") ? r.contact : "")}" placeholder="guest@email.com"></div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-brass btn-sm" data-action="run-charge" data-ref="${r.ref}" type="button">Charge ${money(due)}</button>`,
  });
}

/* ---------------- Global action dispatch ---------------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  // notification bell (no data-action)
  if (e.target.closest("#notifBtn")) {
    openModal({
      title: "Notifications", sub: "Today",
      body: `<div class="row-list">
        <div class="row-item"><span class="pill pending"><i></i>New</span><div class="ri-main"><strong>Booking request: Greg Poulsen</strong><span>B2 · Oct 30 – Nov 2 · $655.20</span></div></div>
        <div class="row-item"><span class="pill pending"><i></i>New</span><div class="ri-main"><strong>Booking request: Nina Rossi</strong><span>C2 · Oct 30 – Nov 1 · $348.60</span></div></div>
        <div class="row-item"><span class="pill overdue"><i></i>Unpaid</span><div class="ri-main"><strong>R-1042 balance $486.20</strong><span>Daniel Okafor · due yesterday</span></div></div>
      </div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Close</button>`,
    });
    return;
  }
  if (!el) return;
  const a = el.dataset.action, ref = el.dataset.ref;

  if (a === "new-reservation") openNewReservation();
  else if (a === "res-detail") openResDetail(ref);
  else if (a === "charge") { closeModal(); setTimeout(() => openCharge(ref), 30); }
  else if (a === "confirm-res") {
    const r = reservations.find((x) => x.ref === ref); r.status = "confirmed";
    if (window.SHDB && r.id) SHDB.setReservationStatus(r.id, "confirmed").catch(() => toast("Status saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderReservations(); renderToday(); toast(`${ref} confirmed`, r.guest, "ok");
  }
  else if (a === "save-reservation") {
    const name = $("#nrName").value.trim() || "Walk-in Guest";
    const contact = $("#nrContact").value.trim() || "—";
    const room = $("#nrRoom").value;
    const nin = $("#nrIn").value, nout = $("#nrOut").value;
    const nights = Math.max(1, Math.round((new Date(nout) - new Date(nin)) / dayMs));
    const subtotal = nightlySum(roomByCode(room), nin, nout);
    const taxEst = taxes.filter((t) => t.on).reduce((s, t) => s + (t.kind === "percent" ? subtotal * t.value / 100 : t.value * nights), 0);
    const total = Math.round((subtotal + taxEst) * 100) / 100;
    const id = "R-" + (1053 + reservations.length - 12);
    const local = { ref: id, guest: name, contact, room, inN: Math.round((new Date(nin) - TODAY) / dayMs), outN: Math.round((new Date(nout) - TODAY) / dayMs), status: "confirmed", total, paid: 0 };
    reservations.unshift(local);
    if (window.SHDB && SHDB.hasLive()) {
      SHDB.createReservation({
        ref: id, guestName: name, contact, roomCode: room, checkIn: nin, checkOut: nout,
        status: "confirmed", source: "direct", notes: $("#nrNotes").value,
        subtotalCents: Math.round(subtotal * 100), taxCents: Math.round(taxEst * 100),
        totalCents: Math.round(total * 100), paidCents: 0
      }).then((row) => { if (row) local.id = row.id; })
        .catch((err) => toast("Saved in this browser only", "Supabase rejected it (dates may overlap): " + err.message, "warn"));
    }
    closeModal(); renderReservations(); renderToday(); renderFolios();
    toast(`Reservation ${id} created`, `${name} · ${room} · ${nights} night${nights > 1 ? "s" : ""}`, "ok");
  }
  else if (a === "run-charge") {
    const r = reservations.find((x) => x.ref === ref);
    const amt = Math.min(parseFloat($("#chAmt").value) || 0, balance(r));
    const methodLabel = $("#chMethod").value;
    r.paid = Math.round((r.paid + amt) * 100) / 100;
    txns.unshift({ when: "Just now", desc: `${r.ref} · Charge · ${r.guest}`, method: methodLabel, status: "paid", amount: amt });
    if (window.SHDB && r.id) {
      SHDB.updateReservationPaid(r.id, Math.round(r.paid * 100))
        .then(() => SHDB.addTransaction({ reservationId: r.id, description: `${r.ref} · Charge · ${r.guest}`, method: methodLabel, status: "paid", amountCents: Math.round(amt * 100) }))
        .catch(() => toast("Payment shown locally only", "Supabase write failed", "warn"));
    }
    closeModal(); renderReservations(); renderFolios(); renderTxns();
    toast(`Charged ${money(amt)}`, `${r.ref} · ${balance(r) > 0 ? money(balance(r)) + " still due" : "paid in full"}`, "ok");
  }
  else if (a === "record-cash") {
    const open = reservations.filter((r) => balance(r) > 0 && r.status !== "cancelled");
    if (!open.length) { toast("No open balances", "Every folio is settled", "ok"); return; }
    openModal({
      title: "Record cash payment", sub: "For walk-ins and front-desk payments",
      body: `<div class="form-2"><div class="field"><label>Reservation</label><select class="select" id="cashRes">${open.map((r) => `<option value="${r.ref}">${r.ref} · ${esc(r.guest)} · ${money(balance(r))} due</option>`).join("")}</select></div>
        <div class="field"><label>Amount received</label><input class="input mono" id="cashAmt" type="number" min="0" step="0.01" value="${balance(open[0]).toFixed(2)}"></div></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" data-action="cash-done" type="button">Record payment</button>`
    });
  }
  else if (a === "cash-done") {
    const r = reservations.find((x) => x.ref === $("#cashRes").value);
    const amt = Math.min(parseFloat($("#cashAmt").value) || 0, balance(r));
    if (!r || amt <= 0) { toast("Enter an amount", "Up to the open balance", "warn"); return; }
    r.paid = Math.round((r.paid + amt) * 100) / 100;
    txns.unshift({ when: "Just now", desc: `${r.ref} · Cash · ${r.guest}`, method: "Cash", status: "paid", amount: amt });
    if (window.SHDB && r.id) {
      SHDB.updateReservationPaid(r.id, Math.round(r.paid * 100))
        .then(() => SHDB.addTransaction({ reservationId: r.id, description: `${r.ref} · Cash · ${r.guest}`, method: "Cash", status: "paid", amountCents: Math.round(amt * 100) }))
        .catch(() => toast("Cash shown locally only", "Supabase write failed", "warn"));
    }
    closeModal(); renderReservations(); renderFolios(); renderTxns();
    toast("Cash payment recorded", `${money(amt)} on ${r.ref}`, "ok");
  }
  else if (a === "export") {
    const activeView = document.querySelector(".view.active")?.id || "";
    const csvCell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    let rows, fname;
    if (activeView === "view-reports") {
      rows = [["Metric", "Value"], ["Revenue (Oct)", "$18.4k"], ["Direct booking share", "55%"], ["Tax liability total", "$1,544.50"], ["", ""], ["Top unit", "Revenue"]]
        .concat([["B3 Fern Hollow", 3210], ["C1 Grove House", 2980], ["B1 Dogwood Cabin", 2744], ["A2 Birch Cabin", 2510]]);
      fname = "simplehotelier-report.csv";
    } else {
      rows = [["Guest", "Confirmation", "Room", "Check-in offset", "Check-out offset", "Status", "Total", "Paid", "Balance"]]
        .concat(reservations.filter(resMatches).map((r) => [r.guest, r.ref, r.room, r.inN, r.outN, r.status, r.total.toFixed(2), r.paid.toFixed(2), balance(r).toFixed(2)]));
      fname = "simplehotelier-reservations.csv";
    }
    const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
    const aEl = document.createElement("a");
    aEl.href = URL.createObjectURL(blob); aEl.download = fname; aEl.click();
    setTimeout(() => URL.revokeObjectURL(aEl.href), 2000);
    toast("Export downloaded", fname, "ok");
  }
  else if (a === "room-types") openRoomTypes();
  else if (a === "goto-rates") { goto("rates"); }
  else if (a === "edit-room") openEditRoom(el.dataset.code);
  else if (a === "room-photos") openRoomPhotos(el.dataset.code);
  else if (a === "room-rates") { ratesRoomCode = el.dataset.code; goto("rates"); }
  else if (a === "rt-edit") openRoomTypes(roomTypes[+el.dataset.i].id);
  else if (a === "rt-del") {
    const [gone] = roomTypes.splice(+el.dataset.i, 1);
    rooms.forEach((r) => { if (r.typeId === gone.id) r.typeId = null; });
    if (window.SHDB && gone.id && !String(gone.id).startsWith("demo-")) SHDB.deleteRoomType(gone.id).catch(() => toast("Deleted locally only", "Supabase delete failed", "warn"));
    toast(`Deleted type “${gone.name}”`, "Rooms keep their own names and rates", "warn");
    openRoomTypes();
  }
  else if (a === "rt-save") {
    const name = $("#rtName").value.trim();
    if (!name) { toast("Give the type a name", "e.g. Cabin, Suite, Loft", "warn"); return; }
    const desc = $("#rtDesc").value.trim();
    const editId = el.dataset.edit;
    if (editId) {
      const t = roomTypes.find((x) => x.id === editId);
      const oldName = t.name;
      t.name = name; t.desc = desc;
      rooms.forEach((r) => { if (r.typeId === t.id || r.typeName === oldName) { r.typeName = name; syncRoomType(r); } });
      if (window.SHDB && SHDB.hasLive() && !String(t.id).startsWith("demo-")) SHDB.updateRoomType(t.id, t).catch(() => toast("Type saved locally only", "Supabase write failed", "warn"));
      else if (window.SHDB && SHDB.hasLive()) SHDB.createRoomType(t).then((row) => { if (row) t.id = row.id; }).catch(() => {});
      toast("Room type saved", name, "ok");
    } else {
      const nt = { id: "local-" + Date.now(), name, desc };
      roomTypes.push(nt);
      if (window.SHDB && SHDB.hasLive()) SHDB.createRoomType(nt).then((row) => { if (row) nt.id = row.id; }).catch(() => toast("Type saved locally only", "Supabase write failed", "warn"));
      toast("Room type added", name, "ok");
    }
    renderRooms();
    openRoomTypes();
  }
  else if (a === "save-edit-room") {
    const r = roomByCode(el.dataset.code);
    r.name = $("#erName").value.trim() || r.name;
    r.sleeps = parseInt($("#erSleeps").value) || r.sleeps || 2;
    r.rate = parseFloat($("#erRate").value) || r.rate;
    r.note = $("#erNotes").value.trim();
    const t = roomTypes.find((x) => x.id === $("#erType").value);
    r.typeId = t ? t.id : null;
    r.typeName = t ? t.name : "";
    syncRoomType(r);
    if (window.SHDB && r.id) SHDB.updateRoom(r.id, { name: r.name, sleeps: r.sleeps, rate: r.rate, typeId: r.typeId, notes: r.note }).catch(() => toast("Room saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderRooms(); renderRates();
    toast(`${r.code} saved`, `${r.name} · ${money(r.rate)}/night default`, "ok");
  }
  else if (a === "rd-save") {
    const room = ratesRoom();
    const val = parseFloat($("#rdRate").value);
    if (isNaN(val) || val < 0) { toast("Enter a valid rate", "USD per night", "warn"); return; }
    rateOverrides[room.code + "|" + el.dataset.date] = val;
    if (window.SHDB && room.id) SHDB.upsertRateOverrides(room.id, room.code, [{ date: el.dataset.date, rate: val }]).catch(() => toast("Rate saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderRates();
    toast(`${room.code} · ${el.dataset.date}`, `Override set to ${money(val)}`, "ok");
  }
  else if (a === "rd-clear") {
    const room = ratesRoom();
    delete rateOverrides[room.code + "|" + el.dataset.date];
    if (window.SHDB && room.id) SHDB.deleteRateOverride(room.id, el.dataset.date).catch(() => toast("Cleared locally only", "Supabase delete failed", "warn"));
    closeModal(); renderRates();
    toast(`${room.code} · ${el.dataset.date}`, `Back to default ${money(room.rate)}`, "ok");
  }
  else if (a === "rates-apply") {
    const room = ratesRoom();
    const from = $("#rateFrom").value, to = $("#rateTo").value, val = parseFloat($("#rateBulk").value), mode = $("#rateMode").value;
    if (!room || !from || !to || isNaN(val)) { toast("Pick a room, range and rate", "All three are needed for bulk rates", "warn"); return; }
    const entries = [];
    const d = new Date(from + "T12:00:00"), end = new Date(to + "T12:00:00");
    while (d <= end) {
      const dow = d.getDay();
      const weekend = dow === 5 || dow === 6 || dow === 0;
      if (mode === "all" || (mode === "weekends" && weekend) || (mode === "weekdays" && !weekend)) {
        const iso = isoLocal(d);
        rateOverrides[room.code + "|" + iso] = val;
        entries.push({ date: iso, rate: val });
      }
      d.setDate(d.getDate() + 1);
    }
    if (window.SHDB && room.id && entries.length) SHDB.upsertRateOverrides(room.id, room.code, entries).catch(() => toast("Rates saved locally only", "Supabase write failed", "warn"));
    renderRates();
    toast(`${entries.length} nights updated`, `${room.code} at ${money(val)}`, "ok");
  }
  else if (a === "rates-clear") {
    const room = ratesRoom();
    const from = $("#rateFrom").value, to = $("#rateTo").value;
    if (!room || !from || !to) { toast("Pick a room and range", "Then clear overrides inside it", "warn"); return; }
    const d = new Date(from + "T12:00:00"), end = new Date(to + "T12:00:00");
    let n = 0;
    const clears = [];
    while (d <= end) {
      const iso = isoLocal(d);
      if (rateOverrides[room.code + "|" + iso] != null) { delete rateOverrides[room.code + "|" + iso]; n++; clears.push(iso); }
      d.setDate(d.getDate() + 1);
    }
    if (window.SHDB && room.id) clears.forEach((iso) => SHDB.deleteRateOverride(room.id, iso).catch(() => {}));
    renderRates();
    toast(`${n} overrides cleared`, `${room.code} uses default ${money(room.rate)} there`, "ok");
  }
  else if (a === "photo-del") {
    const r = roomByCode(el.dataset.code);
    r.photos.splice(+el.dataset.i, 1);
    if (window.SHDB && r.id) SHDB.updateRoom(r.id, { photos: r.photos }).catch(() => {});
    renderRooms();
    openRoomPhotos(r.code);
  }
  else if (a === "print-hk") { window.print(); }
  else if (a === "copy-link") {
    navigator.clipboard?.writeText("https://" + $("#bkUrl").value).catch(() => {});
    toast("Link copied", $("#bkUrl").value, "ok");
  }
  else if (a === "publish-page") {
    if (window.SHDB && SHDB.hasLive()) {
      const slugVal = $("#bkUrl").value.trim().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
      SHDB.updateTenantSettings({
        name: $("#bkName").value.trim(),
        slug: slugVal || undefined,
        booking_headline: $("#bkHead").value.trim(),
        booking_subheading: $("#bkSub").value.trim(),
        brand_color: document.body.dataset.brand || "#0c3b3c",
        ga_measurement_id: $("#bkGa").value.trim() || null,
        booking_redirect_url: $("#bkRedirect").value.trim() || null
      }).then(() => { updateEmbed({ slug: slugVal }); toast("Booking page published", "Settings saved to Supabase", "ok"); })
        .catch(() => toast("Could not save settings", "Apply the booking migration (20261027000000), then retry", "warn"));
    } else {
      toast("Booking page published", $("#bkUrl").value, "ok");
    }
  }
  else if (a === "copy-embed") {
    const ta = $("#bkEmbed");
    if (ta) { navigator.clipboard?.writeText(ta.value).catch(() => {}); ta.select(); }
    toast("Embed code copied", "Paste it into your website", "ok");
  }
  else if (a === "mock-search") { const l = $("#bkOpenLink"); if (l) window.open(l.href, "_blank"); }
  else if (a === "connect-bank") {
    (async () => {
      if (!window.SHDB || !SHDB.hasLive()) { toast("Sign in live first", "Stripe Connect onboarding needs your property account", "warn"); return; }
      try {
        const c = window.SH_CONFIG || {};
        const token = localStorage.getItem("sh_access_token") || c.SUPABASE_ANON_KEY;
        const res = await fetch((c.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/stripe-connect", {
          method: "POST",
          headers: { apikey: c.SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: SHDB.tenantId() })
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.onboarding_url) { location.href = d.onboarding_url; return; }
        toast("Stripe Connect not ready", d.error || "Check function secrets, then retry", "warn");
      } catch { toast("Stripe Connect not ready", "Deploy stripe-connect with Stripe secrets", "warn"); }
    })();
  }
  else if (a === "invite") {
    const link = location.origin + location.pathname.replace(/[^/]*$/, "") + "app.html#signup";
    openModal({
      title: "Invite your cleaners", sub: "They sign up free and only see housekeeping",
      body: `<div class="field"><label>Cleaner email</label><input class="input" id="invEmail" type="email" placeholder="cleaner@email.com"></div>
        <div class="field"><label>Signup link</label><input class="input mono" id="invLink" readonly value="${esc(link)}"></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-action="invite-copy" type="button">Copy link</button>
        <button class="btn btn-primary btn-sm" data-action="invite-send" type="button">Open email invite</button>`
    });
  }
  else if (a === "invite-copy") {
    const i = $("#invLink"); if (i) { navigator.clipboard?.writeText(i.value).catch(() => {}); toast("Invite link copied", "Send it to your cleaner", "ok"); }
  }
  else if (a === "invite-send") {
    const email = $("#invEmail").value.trim();
    const link = $("#invLink").value;
    const subject = encodeURIComponent("Join SimpleHotelier housekeeping");
    const body = encodeURIComponent("Hi,\n\nYou are invited to help with housekeeping. Sign up here, then tell the property owner your email so they can add you:\n" + link + "\n\nThanks!");
    location.href = `mailto:${email}?subject=${subject}&body=${body}`;
    closeModal();
    toast("Email draft opened", email || "Address it to your cleaner", "ok");
  }
  else if (a === "save-settings") {
    const patch = {
      name: $("#pfName").value.trim(), contact_email: $("#pfEmail").value.trim(),
      check_in_time: $("#pfCheckIn").value.trim(), check_out_time: $("#pfCheckOut").value.trim(),
      cancellation_policy: ["moderate", "flexible", "strict"][$("#pfPolicy").selectedIndex] || "moderate"
    };
    if ($("#bkName")) $("#bkName").value = patch.name;
    if (window.SHDB && SHDB.hasLive()) {
      SHDB.updateTenantSettings(patch).then(() => toast("Settings saved", "Property profile updated", "ok"))
        .catch(() => toast("Settings saved locally only", "Supabase write failed", "warn"));
    } else toast("Settings saved", "Property profile updated (demo)", "ok");
  }
  else if (a === "toggle-addon") {
    const ad = addons[+el.dataset.i]; ad.on = !ad.on; renderAddons();
    if (window.SHDB && ad.id) SHDB.setAddonActive(ad.id, ad.on).catch(() => toast("Visibility saved locally only", "Supabase write failed", "warn"));
  }
  else if (a === "del-addon") {
    const [gone] = addons.splice(+el.dataset.i, 1); renderAddons();
    if (window.SHDB && gone.id) SHDB.deleteAddon(gone.id).catch(() => toast("Removed locally only", "Supabase delete failed", "warn"));
    toast(`Removed “${gone.name}”`, "It no longer shows at checkout", "warn");
  }
  else if (a === "del-tax") {
    const [gone] = taxes.splice(+el.dataset.i, 1); renderTaxes();
    if (window.SHDB && gone.id) SHDB.deleteTax(gone.id).catch(() => toast("Removed locally only", "Supabase delete failed", "warn"));
    toast(`Removed “${gone.name}”`, "Totals recalculated", "warn");
  }
  else if (a === "add-addon") {
    openModal({
      title: "New add-on charge", sub: "Guests can add this at checkout",
      body: `<div class="form-2"><div class="field"><label>Name</label><input class="input" id="adName" placeholder="e.g. Sunrise yoga session"></div>
        <div class="field"><label>Price</label><input class="input mono" id="adPrice" type="number" value="30"></div></div>
        <div class="form-2"><div class="field"><label>Charged per</label><select class="select" id="adPer"><option>stay</option><option>night</option><option>person</option></select></div>
        <div class="field"><label>Description</label><input class="input" id="adDesc" placeholder="Short guest-facing text"></div></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" data-action="save-addon" type="button">Add add-on</button>`,
    });
  }
  else if (a === "save-addon") {
    const na = { name: $("#adName").value.trim() || "Custom add-on", price: parseFloat($("#adPrice").value) || 0, per: $("#adPer").value, on: true, desc: $("#adDesc").value.trim() || "Custom charge" };
    addons.unshift(na);
    if (window.SHDB && SHDB.hasLive()) SHDB.createAddon(na).then((row) => { if (row) na.id = row.id; }).catch(() => toast("Add-on saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderAddons(); toast("Add-on added", "Now available at checkout", "ok");
  }
  else if (a === "add-tax") {
    openModal({
      title: "New tax or fee", sub: "Applied automatically to every folio",
      body: `<div class="form-2"><div class="field"><label>Name</label><input class="input" id="txName" placeholder="e.g. City lodging fee"></div>
        <div class="field"><label>Type</label><select class="select" id="txKind"><option value="percent">Percent of subtotal</option><option value="night">Flat per night</option></select></div></div>
        <div class="form-2"><div class="field"><label>Value</label><input class="input mono" id="txVal" type="number" step="0.01" value="2"></div>
        <div class="field"><label>Applies to</label><select class="select"><option>Room + add-ons</option><option>Room only</option></select></div></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" data-action="save-tax" type="button">Add rule</button>`,
    });
  }
  else if (a === "save-tax") {
    const nt = { name: $("#txName").value.trim() || "Custom fee", kind: $("#txKind").value, value: parseFloat($("#txVal").value) || 0, applies: "Room + add-ons", on: true };
    taxes.push(nt);
    if (window.SHDB && SHDB.hasLive()) SHDB.createTax(nt).then((row) => { if (row) nt.id = row.id; }).catch(() => toast("Tax saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderTaxes(); toast("Tax rule added", "Totals recalculated everywhere", "ok");
  }
  else if (a === "add-room") {
    openModal({
      title: "Add a room or cabin", sub: "It appears on your booking page immediately",
      body: `<div class="form-2"><div class="field"><label>Code</label><input class="input" id="rmCode" placeholder="e.g. D1"></div>
        <div class="field"><label>Name</label><input class="input" id="rmName" placeholder="e.g. Juniper Lodge"></div></div>
        <div class="field"><label>Room type</label><select class="select" id="rmType">${roomTypes.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></div>
        <div class="form-2"><div class="field"><label>Sleeps</label><input class="input" id="rmSleeps" type="number" min="1" value="2"></div>
        <div class="field"><label>Nightly rate (USD)</label><input class="input mono" id="rmRate" type="number" min="0" value="150"></div></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" data-action="save-room" type="button">Add unit</button>`
    });
  }
  else if (a === "save-room") {
    const typeSel = roomTypes.find((t) => t.id === $("#rmType").value);
    const nr = { code: ($("#rmCode").value.trim() || "NEW").toUpperCase(), name: $("#rmName").value.trim() || "New unit", sleeps: parseInt($("#rmSleeps").value) || 2, rate: parseFloat($("#rmRate").value) || 0, typeId: typeSel && !String(typeSel.id).startsWith("demo-") ? typeSel.id : null };
    const localRoom = { code: nr.code, name: nr.name, sleeps: nr.sleeps, typeId: nr.typeId, typeName: typeSel ? typeSel.name : "Cabin", type: "", rate: nr.rate, status: "vacant", hk: "clean", guest: "", note: "New unit — add photos & details", photos: [] };
    syncRoomType(localRoom);
    rooms.push(localRoom);
    if (window.SHDB && SHDB.hasLive()) SHDB.createRoom(nr).then((row) => { if (row) localRoom.id = row.id; }).catch(() => toast("Room saved locally only", "Supabase write failed (code may already exist)", "warn"));
    closeModal(); renderRooms(); renderMiniRooms();
    toast(`${nr.code} · ${nr.name} added`, "Set its booking-page photos next", "ok");
  }
});

/* Global search: jump to matching reservation */
$("#globalSearch").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim().toLowerCase();
  const hit = reservations.find((r) => (r.guest + r.ref + r.room).toLowerCase().includes(q));
  if (hit) { goto("reservations"); resQuery = q; $("#resSearch").value = e.target.value; resFilter = "all"; $$("#resFilter button").forEach((x, i) => x.classList.toggle("active", i === 0)); renderReservations(); openResDetail(hit.ref); }
  else toast("No matches", `Nothing found for “${e.target.value}”`, "warn");
});

/* ---------------- Boot ---------------- */
renderToday(); renderMiniRooms(); renderReservations(); renderCalendar();
renderRooms(); renderHK(); renderFolios(); renderTxns();
renderAddons(); renderTaxes(); renderMockRooms(); renderReports();
bindStudio(); updateEmbed(null);

/* Live Supabase data (falls back silently to demo data when unconfigured).
   Reservations require a signed-in member under RLS; rooms/add-ons/taxes are public. */
function loadLiveIntoUI() {
  const statusEl = $("#dbStatus");
  if (!window.SHDB || !SHDB.configured()) {
    if (statusEl) statusEl.textContent = "Data source: demo data (add your Supabase keys in js/config.js)";
    return;
  }
  SHDB.loadLiveData().then((live) => {
    if (!live) {
      if (statusEl) statusEl.textContent = "Data source: demo data (Supabase unreachable — check js/config.js)";
      return;
    }
    if (!live.tenant) {
      if (statusEl) statusEl.textContent = "Signed in as " + (live.user ? live.user.email : "") + " — no property linked yet. Create one from the signup screen.";
      toast("No property linked yet", "Sign out, then Create account to add your property", "warn");
      return;
    }
    if (live.rooms.length) { rooms.splice(0, rooms.length, ...live.rooms); }
    if (live.reservations.length) { reservations.splice(0, reservations.length, ...live.reservations); }
    if (live.addons.length) { addons.splice(0, addons.length, ...live.addons); }
    if (live.taxes.length) { taxes.splice(0, taxes.length, ...live.taxes); }
    if (live.roomTypes && live.roomTypes.length) roomTypes = live.roomTypes;
    if (live.rateOverrides) { rateOverrides = {}; live.rateOverrides.forEach((o) => { if (o.roomCode) rateOverrides[o.roomCode + "|" + o.date] = o.rate; }); }
    if (live.txns && live.txns.length) { txns.splice(0, txns.length, ...live.txns); }
    renderToday(); renderMiniRooms(); renderReservations(); renderCalendar();
    renderRooms(); renderHK(); renderFolios(); renderTxns(); renderAddons(); renderTaxes(); renderMockRooms();
    if (live.user) {
      $("#userName").textContent = live.user.email;
      $("#userRole").textContent = "Owner · " + live.tenant.name;
      $("#userAvatar").textContent = (live.user.email || "U").slice(0, 2).toUpperCase();
    }
    if ($("#bkGa")) $("#bkGa").value = live.tenant.ga_measurement_id || "";
    if ($("#bkRedirect")) $("#bkRedirect").value = live.tenant.booking_redirect_url || "";
    if (live.tenant.booking_headline && $("#bkHead")) { $("#bkHead").value = live.tenant.booking_headline; $("#mockHead").textContent = live.tenant.booking_headline; }
    if (live.tenant.booking_subheading && $("#bkSub")) { $("#bkSub").value = live.tenant.booking_subheading; $("#mockSub").textContent = live.tenant.booking_subheading; }
    updateEmbed(live.tenant);
    if ($("#pfName")) $("#pfName").value = live.tenant.name || "";
    if ($("#pfEmail")) $("#pfEmail").value = live.tenant.contact_email || "";
    if ($("#pfCheckIn")) $("#pfCheckIn").value = live.tenant.check_in_time || "3:00 PM";
    if ($("#pfCheckOut")) $("#pfCheckOut").value = live.tenant.check_out_time || "11:00 AM";
    if ($("#pfPolicy")) { const ix = ["moderate", "flexible", "strict"].indexOf(live.tenant.cancellation_policy); $("#pfPolicy").selectedIndex = ix >= 0 ? ix : 0; }
    if (live.tenant.logo_url && $("#logoPreview")) { $("#logoPreview").src = live.tenant.logo_url; $("#logoPreview").hidden = false; const le = $("#logoEmpty"); if (le) le.style.display = "none"; }
    renderRates();
    if ($("#billStatus")) $("#billStatus").textContent = live.tenant.subscription_status || "trialing";
    if ($("#billPeriod")) $("#billPeriod").textContent = live.tenant.current_period_end ? new Date(live.tenant.current_period_end).toLocaleDateString() : "-";
    if (statusEl) statusEl.textContent = "Data source: Supabase · " + live.tenant.name + " (live" + (live.user ? " · " + live.user.email : "") + ")";
    toast("Connected to Supabase", live.tenant.name + " loaded live", "ok");
  });
}
loadLiveIntoUI();
window.addEventListener("sh-auth", (e) => {
  loadLiveIntoUI();
  toast("Welcome" + (e.detail && e.detail.user ? ", " + e.detail.user.email : ""), "Loading your property…", "ok");
});
