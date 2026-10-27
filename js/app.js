/* SimpleHotelier — interactive prototype (demo data, no backend) */
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
/* Money shows in the property's currency (Settings > Currency, js/money.js). */
let moneyCurrency = "USD";
const money = (n) => SHMoney.format(n, moneyCurrency);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- Demo data ---------------- */
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })(); // local today; demo data offsets count from here
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
/* ---- Room type detail vocabularies ---- */
const RT_VIEWS = ["", "No particular view", "Garden view", "Courtyard view", "City view", "Forest / woodland view", "Mountain view", "Valley view", "Lake view", "River view", "Ocean view", "Partial ocean view", "Beachfront", "Pool view", "Desert view", "Ski slope view", "Landmark view", "Panoramic view"];
const RT_SMOKING = [["non-smoking", "Non-smoking"], ["outdoor-only", "Smoking outdoors / balcony only"], ["smoking-allowed", "Smoking allowed"]];
const RT_BED_TYPES = ["King", "California King", "Queen", "Full / Double", "Twin XL", "Twin", "Bunk bed", "Sofa bed", "Daybed", "Futon", "Murphy bed", "Rollaway", "Air mattress", "Crib"];
const RT_ACCESS_FEATURES = ["Step-free entry", "Ground floor", "Elevator access", "Wide doorways (32 in+)", "Accessible parking nearby", "Accessible route to room", "Roll-in shower", "Grab bars in shower", "Grab bars by toilet", "Shower seat / bench", "Handheld showerhead", "Raised toilet", "Lowered sink / vanity", "Lowered counters", "Lever door handles", "Lowered light switches", "Lowered bed", "Transfer space beside bed", "Visual fire alarm", "Visual doorbell / hearing kit", "Braille signage", "Service animals welcome"];
const RT_FEATURES = ["Air conditioning", "Ceiling fan", "Heating", "Fireplace", "Blackout curtains", "Soundproofing", "Windows that open", "Alarm clock", "Reading light", "Extra pillows & blankets", "Linens provided", "Towels provided", "Wardrobe / closet", "Dresser", "Nightstands", "Sofa", "Armchair", "Desk / workspace", "Dining table", "Safe", "Iron & ironing board", "Hair dryer", "Bath", "Shower", "Bathtub & shower", "Soaking tub", "Jetted tub", "Bidet", "Double vanity", "Rain shower", "Handheld shower", "Bathrobes", "Slippers", "Toiletries", "Flat-screen TV", "Cable TV", "Streaming TV", "Free WiFi", "High-speed WiFi", "Ethernet connection", "USB chargers", "Bluetooth speaker", "Board games", "Books", "Full kitchen", "Kitchenette", "Plates & glassware", "Cutlery", "Pots & pans", "Mini fridge", "Full-size fridge", "Microwave", "Oven", "Stovetop", "Dishwasher", "Coffee maker", "Espresso machine", "Kettle", "Toaster", "BBQ utensils", "Washer", "Dryer", "Washer / dryer", "Laundry service", "Private balcony", "Private patio", "Deck / porch", "Outdoor furniture", "BBQ / grill", "Fire pit", "Hot tub", "Private entrance", "24-hour security", "Keyless entry", "Smart lock", "Daily housekeeping", "Free parking", "Garage", "EV charger", "Bike storage", "Ski storage", "Pool access", "Gym access", "Sauna", "Beach access", "Lake access", "Pet friendly", "High chair", "Pack 'n play / crib"];
function normalizeRatePlan(p) {
  const n = { ...(p || {}) };
  n.id = n.id || "plan-" + Math.random().toString(36).slice(2, 8);
  n.name = n.name || ""; n.desc = n.desc || "";
  n.minStay = n.minStay != null ? n.minStay : 1; n.maxStay = n.maxStay || 0;
  n.releasePeriod = n.releasePeriod || 0;
  n.rateKind = n.rateKind === "flat" ? "flat" : "percent";
  n.difference = Number(n.difference) || 0;
  ["extraAdultRate", "extraChildRate", "extraInfantRate"].forEach((k) => { n[k] = Number(n[k]) || 0; });
  n.includedOccupants = n.includedOccupants === "" || n.includedOccupants == null ? null : Number(n.includedOccupants);
  ["maxAdults", "maxChildren", "maxInfants", "maxOccupants"].forEach((k) => { n[k] = n[k] === "" || n[k] == null ? null : Number(n[k]); });
  n.promoCode = String(n.promoCode || "").trim();
  return n;
}
function normalizeRoomType(t) {
  const n = { ...(t || {}) };
  n.bathrooms = n.bathrooms != null ? Number(n.bathrooms) : 1;
  n.view = n.view || ""; n.smoking = n.smoking || "non-smoking";
  n.minStay = n.minStay != null ? n.minStay : 1; n.maxStay = n.maxStay || 0;
  ["rackRate", "extraAdultRate", "extraChildRate", "extraInfantRate"].forEach((k) => { n[k] = Number(n[k]) || 0; });
  n.includedAdults = n.includedAdults != null ? n.includedAdults : 2;
  n.includedChildren = n.includedChildren || 0; n.includedInfants = n.includedInfants || 0;
  n.maxAdults = n.maxAdults || 0; n.maxChildren = n.maxChildren || 0;
  n.maxInfants = n.maxInfants || 0; n.maxOccupants = n.maxOccupants || 0;
  n.adultsRequired = n.adultsRequired != null ? n.adultsRequired : 1;
  n.beds = Array.isArray(n.beds) ? n.beds : [];
  n.ratePlans = (Array.isArray(n.ratePlans) ? n.ratePlans : []).map(normalizeRatePlan);
  n.handicapAccessible = !!n.handicapAccessible;
  n.accessibleFeatures = Array.isArray(n.accessibleFeatures) ? n.accessibleFeatures : [];
  n.features = Array.isArray(n.features) ? n.features : [];
  n.photos = Array.isArray(n.photos) ? n.photos : [];
  return n;
}
let roomTypes = [
  { id: "demo-cabin", name: "Cabin", desc: "Standalone cabin", bathrooms: 1, view: "Forest / woodland view", smoking: "outdoor-only", rackRate: 249, minStay: 2, includedAdults: 2, maxAdults: 4, maxChildren: 2, maxInfants: 1, maxOccupants: 6, adultsRequired: 1, beds: [{ qty: 1, type: "Queen" }, { qty: 2, type: "Twin" }], features: ["Air conditioning", "Heating", "Fireplace", "Full kitchen", "Plates & glassware", "Flat-screen TV", "Free WiFi", "Deck / porch", "Fire pit", "Towels provided", "Linens provided"], ratePlans: [{ id: "plan-extended", name: "Extended stay rate", desc: "Enjoy 10% off when booking for more than three nights.", minStay: 3, maxStay: 30, releasePeriod: 0, rateKind: "percent", difference: -10, extraAdultRate: 20, extraChildRate: 0, extraInfantRate: 0, includedOccupants: 2, maxAdults: 5, maxChildren: 4, maxInfants: 0, maxOccupants: 6, promoCode: "" }] },
  { id: "demo-suite", name: "Suite", desc: "Suite in the main lodge" },
  { id: "demo-loft", name: "Loft", desc: "Upper loft unit" },
  { id: "demo-house", name: "House", desc: "Full vacation house" }
].map(normalizeRoomType);
/* Pricing lives on room types (hotels price King / Queen / Suite, not units).
   Per-date overrides: "TYPEID|YYYY-MM-DD" -> rules. No entry = type nightly rate. */
let rateOverrides = { "demo-cabin|2026-11-06": 299, "demo-cabin|2026-11-07": 299, "demo-house|2026-12-24": 449, "demo-house|2026-12-25": 449, "demo-house|2026-12-26": 449 };
let ratesMonthOff = 0;
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function typeOfRoom(room) {
  if (!room) return null;
  return roomTypes.find((t) => (room.typeId && t.id === room.typeId) || (!room.typeId && room.typeName && t.name === room.typeName)) || null;
}
function typeRate(t) { return t ? (normalizeRoomType(t).rackRate || 0) : 0; }
function typeSleeps(t) { const tn = t ? normalizeRoomType(t) : null; return tn ? (tn.maxOccupants > 0 ? tn.maxOccupants : (tn.includedAdults + tn.includedChildren + tn.includedInfants) || 2) : 2; }
function roomRate(room) { const tr = typeRate(typeOfRoom(room)); return tr > 0 ? tr : (room ? room.rate || 0 : 0); }
function ovForType(t, iso) {
  if (!t) return null;
  const v = rateOverrides[t.id + "|" + iso];
  if (v == null) return null;
  if (typeof v === "number") return { rate: v, minStay: null, maxStay: null, closed: false, cta: false, ctd: false };
  return v;
}
function ovFor(room, iso) { return ovForType(typeOfRoom(room), iso); }
function rateFor(room, iso) { const o = ovFor(room, iso); return o && o.rate != null ? o.rate : roomRate(room); }
function typeBaseRate(t) { const tr = typeRate(t); if (tr > 0) return tr; const r = rooms.find((x) => typeOfRoom(x) && typeOfRoom(x).id === t.id); return r ? r.rate || 0 : 0; }
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
  { ref: "R-1046", guest: "Tom Becker", contact: "tom.b@mail.com", room: "A1", inN: 0, outN: 3, status: "confirmed", total: 640.75, paid: 200.00, arrival: "4 – 6 PM" },
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

/* Maintenance tickets + external calendar feeds (Airbnb / Vrbo iCal sync). */
let tickets = [
  { id: "demo-t1", roomCode: "A2", title: "Hot tub jets weak on one side", desc: "Guest reported low pressure in the left jet bank. Check pump 2 filter.", photo: "", priority: "high", status: "open", when: "Today" },
  { id: "demo-t2", roomCode: "B1", title: "Leaky kitchen faucet", desc: "Slow drip under the sink; bucket placed. Needs a plumber visit.", photo: "", priority: "normal", status: "in_progress", when: "Yesterday" },
  { id: "demo-t3", roomCode: "C1", title: "Replace porch light bulb", desc: "Front porch bulb out. Spare bulbs are in the laundry closet.", photo: "", priority: "low", status: "open", when: "Oct 24" }
];
let icalFeeds = [];
let liveSlug = "", liveIcalToken = "";
let studioHeroUrl = ""; // booking-page hero image (saved on upload, like the logo)
let studioHeroFocus = { x: 50, y: 50 }; // hero focal point, percent; saved on Publish

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
function openModal({ title, sub = "", body = "", foot = "", wide = false, xl = false }) {
  modal.classList.toggle("wide", !!wide && !xl);
  modal.classList.toggle("xl", !!xl);
  modal.innerHTML = `
    <div class="modal-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
    <button class="modal-x" data-close type="button" aria-label="Close">✕</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? `<div class="modal-foot">${foot}</div>` : ""}`;
  overlay.classList.add("open");
}
function closeModal() { overlay.classList.remove("open"); }
/* Custom confirmation for destructive actions (never native confirm). */
let confirmCb = null;
function confirmAction(title, body, label, cb) {
  confirmCb = cb;
  openModal({
    title, body: `<p style="color:var(--muted);font-size:13.5px;line-height:1.55">${body}</p>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Keep it</button>
      <button class="btn btn-danger btn-sm" data-action="confirm-yes" type="button">${esc(label || "Delete")}</button>`
  });
}
/* Modals stay open on outside clicks and Escape so form input is never lost.
   Only the X, a [data-close] button, or an action that explicitly closes may dismiss one. */
document.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

/* ---------------- Navigation ---------------- */
function goto(view) {
  if (!canSee(view)) view = ROLE_VIEWS[liveRole][0];
  $$("#mainNav .nav-btn, .nav .nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "rates") renderRates();
  if (view === "ratemgmt") renderRateMgmt();
  if (view === "setup") renderSetupUI();
  if (view === "booking") loadFontPreviews(); // theme cards and font pickers show each face
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
function renderDateCtx() {
  const el = $(".date-ctx");
  if (!el) return;
  // Housekeeping roles count from the turnover list (they don't load reservations); maintenance doesn't need it.
  const src = liveRole === "cleaner" ? turnovers : reservations;
  const arr = src.filter((r) => r.inN === 0 && r.status !== "cancelled").length;
  const dep = src.filter((r) => r.outN === 0 && r.status !== "cancelled").length;
  if (liveRole === "maintenance") { el.innerHTML = esc(TODAY.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })); return; }
  el.innerHTML = `${esc(TODAY.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }))}<small>${arr} arrival${arr === 1 ? "" : "s"} · ${dep} departure${dep === 1 ? "" : "s"} today</small>`;
}
function renderToday() {
  renderDateCtx();
  const arr = reservations.filter((r) => r.inN === 0 && r.status !== "cancelled");
  const dep = reservations.filter((r) => r.outN === 0 && r.status !== "cancelled");
  const item = (r, tag) => `
    <div class="row-item"><span class="room-code">${esc(r.room)}</span>
      <div class="ri-main"><strong>${esc(r.guest)} · ${tag}${tag === "Arriving" && r.arrival ? " " + esc(r.arrival) : ""}</strong><span>${esc(resDates(r))} · ${money(r.total)}</span></div>
      <div class="ri-right">${pill(ST[r.status] || ST.confirmed)}</div></div>`;
  $("#todayList").innerHTML =
    arr.map((r) => item(r, "Arriving")).join("") + dep.map((r) => item(r, "Departing")).join("") ||
    `<div class="empty">No movement today.</div>`;
}

let tenantDisplayName = "";
let liveTenant = null, liveMembersCount = 1, setupRouted = false;
/* Team roles (20261122000000_role_scoped_access): which screens each sees.
   The database enforces the same limits; this keeps the UI honest. */
let liveRole = "owner";
let liveProperties = []; // every property this login belongs to: { id, name, role }
const ROLE_VIEWS = {
  staff: ["overview", "reservations", "calendar", "rooms", "housekeeping", "maintenance", "payments", "reports", "support"],
  cleaner: ["housekeeping", "maintenance"],
  maintenance: ["maintenance"]
};
const ROLE_LABELS = { owner: "Owner", admin: "Admin", staff: "Front desk", cleaner: "Housekeeping", maintenance: "Maintenance" };
const canSee = (view) => !ROLE_VIEWS[liveRole] || ROLE_VIEWS[liveRole].includes(view) || view === "admin";
let turnovers = [];
/* One source of truth for setup progress — sidebar, Settings checklist and
   the Setup screen all read from here, so the % is always accurate. */
function computeSetup() {
  const T = liveTenant || {};
  const steps = [
    { key: "profile", title: "Company profile created", desc: T.name ? `${T.name} · address and phone for guests` : "Name, address and phone guests see", done: !!(T.name && (T.address_line1 || T.address) && T.phone), view: "settings", cta: "Edit profile" },
    { key: "rooms", title: rooms.length ? `${rooms.length} room${rooms.length > 1 ? "s" : ""} added with rates` : "Add your rooms and rates", desc: "Each room gets a code, sleeps count and nightly rate", done: rooms.length > 0, view: "rooms", cta: rooms.length ? "Manage rooms" : "Add rooms" },
    { key: "booking", title: "Booking page published", desc: T.slug ? `${T.slug}.simplehotelier.com` : "Your public booking page", done: !!T.booking_headline, view: "booking", cta: "Open booking studio" },
    { key: "taxes", title: taxes.length ? "Taxes configured" : "Configure taxes", desc: taxes.length ? `${taxes.length} rule${taxes.length > 1 ? "s" : ""} applied to totals` : "Lodging tax, tourism fees and other rules", done: taxes.length > 0, view: "addons", cta: "Set up taxes" },
    { key: "payouts", title: "Connect bank payouts", desc: "2–3 day transfers · required to charge cards", done: !!T.stripe_onboarding_complete, action: "connect-bank", cta: "Connect Stripe" },
    { key: "team", title: "Invite your team", desc: liveMembersCount > 1 ? `${liveMembersCount} people on the team` : "Cleaners get a free mobile turnover list", done: liveMembersCount > 1, action: "invite", cta: "Invite" }
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, pct: Math.round(done / steps.length * 100) };
}
function renderSetupUI() {
  const s = computeSetup();
  const next = s.steps.find((x) => !x.done);
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set("#navSetupPct", s.pct >= 100 ? "Done" : s.pct + "%");
  set("#setupPctText", s.pct >= 100 ? "Setup complete" : `Setup ${s.pct}% complete`);
  set("#setupNextText", next ? `${next.title} — next step.` : "You're live. Share your booking page.");
  const bar = $("#setupBar"); if (bar) bar.style.width = s.pct + "%";
  set("#setupBigPct", s.pct + "%");
  const bigBar = $("#setupBigBar"); if (bigBar) bigBar.style.width = s.pct + "%";
  set("#setupBigText", s.pct >= 100 ? "Everything is ready — you're taking bookings." : `${s.done} of ${s.total} steps done. Next: ${next ? next.title : ""}`);
  const title = $("#setupTitle"); if (title && tenantDisplayName) title.textContent = "Finish setting up " + tenantDisplayName;
  const doneCard = $("#setupDone"); if (doneCard) doneCard.hidden = s.pct < 100;
  const wrap = $("#setupSteps");
  if (wrap) wrap.innerHTML = s.steps.map((x) => `
    <div class="row-item" style="align-items:center">
      <span class="box" style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;${x.done ? "background:var(--success);color:#fff" : "border:1.5px solid #b9c8c3;color:transparent"}">✓</span>
      <div class="ri-main"><strong>${esc(x.title)}</strong><span>${esc(x.desc)}</span></div>
      <div class="ri-right"><button class="btn ${x.done ? "btn-ghost" : "btn-primary"} btn-sm" data-action="setup-step" data-key="${x.key}" type="button">${x.done ? "Edit" : esc(x.cta)}</button></div>
    </div>`).join("");
  // Settings checklist mirrors the same truth.
  const rows = $$("#checklist .check");
  s.steps.forEach((x, i) => {
    const row = rows[i]; if (!row) return;
    row.classList.toggle("done", x.done);
    const box = row.querySelector(".box"); if (box) box.textContent = x.done ? "✓" : "";
    const strong = row.querySelector("strong"); if (strong) strong.textContent = x.title;
    const p = row.querySelector("p"); if (p) p.textContent = x.desc;
    const goEdit = row.querySelector(".check-go"); if (goEdit) goEdit.style.display = x.done ? "" : "none";
    if (x.key === "payouts") {
      const btn = row.querySelector("[data-action='connect-bank']");
      if (btn) { btn.textContent = x.done ? "Connected ✓" : "Connect"; btn.disabled = !!x.done; }
    }
  });
}

/* Ask Stripe (via our function) whether Connect onboarding is really done,
   and refresh the checklist when it is. Runs on load and after ?stripe=done. */
let stripeSyncTried = false;
async function syncStripeStatus() {
  if (stripeSyncTried || !window.SHDB || !SHDB.hasLive()) return;
  if (!liveTenant || !liveTenant.stripe_account_id || liveTenant.stripe_onboarding_complete) return;
  stripeSyncTried = true;
  try {
    const d = await fnInvoke("stripe-connect", { tenant_id: SHDB.tenantId(), action: "status" });
    if (d && d.connected) {
      liveTenant.stripe_onboarding_complete = true;
      renderSetupUI();
      toast("Stripe connected", "Bank payouts are live — you can charge guest cards now", "ok");
    }
  } catch { /* Stripe not reachable; the Connect button stays for a retry */ }
}
function renderOverview() {
  const greetEl = $("#ovGreet"), subEl = $("#ovSub");
  if (!greetEl) return;
  const h = new Date().getHours();
  greetEl.textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const prop = tenantDisplayName || ($("#pfName") && $("#pfName").value) || "your property";
  subEl.textContent = `Here's what's happening at ${prop} today.`;
  const active = reservations.filter((r) => r.status !== "cancelled");
  const tonight = new Set(active.filter((r) => r.inN <= 0 && r.outN > 0).map((r) => r.room)).size;
  const occPct = rooms.length ? Math.round(tonight / rooms.length * 100) : 0;
  $("#kOcc").innerHTML = `${occPct}<small>%</small>`;
  $("#kOccSub").textContent = `${tonight} of ${rooms.length} rooms filled tonight`;
  const collected = active.reduce((s, r) => s + r.paid, 0);
  const outstanding = active.reduce((s, r) => s + balance(r), 0);
  $("#kRev").textContent = money(collected);
  $("#kRevSub").textContent = outstanding > 0 ? `${money(outstanding)} still outstanding` : "Nothing outstanding";
  const arr = active.filter((r) => r.inN === 0), dep = active.filter((r) => r.outN === 0);
  $("#kArrDep").innerHTML = `${arr.length} <small>/</small> ${dep.length}`;
  const nextArr = active.filter((r) => r.inN >= 0).sort((a, b) => a.inN - b.inN)[0];
  $("#kArrSub").textContent = nextArr ? `Next arrival: ${esc(nextArr.guest)} · ${esc(nextArr.room)}${nextArr.inN === 0 ? " · today" : nextArr.inN === 1 ? " · tomorrow" : " · in " + nextArr.inN + " days"}` : "No upcoming arrivals";
  const dirty = rooms.filter((r) => r.hk === "dirty").length, prog = rooms.filter((r) => r.hk === "progress").length;
  $("#kClean").textContent = dirty;
  $("#kCleanSub").innerHTML = `${prog} in progress · <button class="drawer-link" data-goto="housekeeping" type="button">Open board →</button>`;
  // Needs attention, derived from live state.
  const items = [];
  active.filter((r) => balance(r) > 0).sort((a, b) => balance(b) - balance(a)).slice(0, 2).forEach((r) => {
    items.push(`<div class="row-item"><span class="pill overdue"><i></i>Unpaid</span><div class="ri-main"><strong>${money(balance(r))} unpaid · ${esc(r.ref)}</strong><span>${esc(r.guest)} · ${esc(r.room)}</span></div><div class="ri-right"><button class="btn btn-ghost btn-xs" data-action="charge" data-ref="${esc(r.ref)}" type="button">Charge</button></div></div>`);
  });
  const dirtyRooms = rooms.filter((r) => r.hk === "dirty");
  if (dirtyRooms.length) items.push(`<div class="row-item"><span class="pill progress"><i></i>Dirty</span><div class="ri-main"><strong>${dirtyRooms.length} room${dirtyRooms.length > 1 ? "s" : ""} to clean</strong><span>${dirtyRooms.map((r) => esc(r.code)).join(", ")}</span></div><div class="ri-right"><button class="btn btn-ghost btn-xs" data-goto="housekeeping" type="button">Open board</button></div></div>`);
  const pend = active.filter((r) => r.status === "pending");
  if (pend.length) items.push(`<div class="row-item"><span class="pill pending"><i></i>Pending</span><div class="ri-main"><strong>${pend.length} request${pend.length > 1 ? "s" : ""} await confirmation</strong><span>${pend.map((r) => esc(r.guest)).slice(0, 2).join(", ")}</span></div><div class="ri-right"><button class="btn btn-ghost btn-xs" data-goto="reservations" type="button">Review</button></div></div>`);
  $("#attentionList").innerHTML = items.join("") || `<div class="empty">All caught up. Nothing needs attention.</div>`;
  renderSetupUI();
  // Sidebar identity + nav badges follow the real property, not the demo.
  const pn = $("#propNameSide"); if (pn && tenantDisplayName) pn.textContent = tenantDisplayName;
  const ps = $("#propSubSide"); if (ps) ps.textContent = `${rooms.length} unit${rooms.length === 1 ? "" : "s"}`;
  const nr = $("#navResCount"); if (nr) { nr.textContent = active.length; nr.style.display = active.length ? "" : "none"; }
  const nh = $("#navHkCount"); if (nh) { nh.textContent = dirty; nh.style.display = dirty ? "" : "none"; }
  const kv = $("#bkPerfKv");
  if (kv) kv.innerHTML = `
    <dt>Rooms listed</dt><dd class="tnum">${rooms.length}</dd>
    <dt>Room types</dt><dd class="tnum">${roomTypes.length}</dd>
    <dt>Add-ons enabled</dt><dd class="tnum">${addons.filter((a) => a.on).length}</dd>
    <dt>Reservations on file</dt><dd class="tnum">${active.length}</dd>
    <dt>Booked revenue</dt><dd class="tnum">${money(active.reduce((s, r) => s + r.total, 0))}</dd>`;
}

function renderMiniRooms() {
  $("#miniRooms").innerHTML = rooms.map((r) => `
    <div style="border:1px solid var(--line);border-radius:10px;padding:10px 11px;background:var(--surface-2)">
      <div style="display:flex;align-items:center;gap:7px"><strong style="color:var(--ink);font-size:13px">${esc(r.code)}</strong>${pill(RSTAT[r.status])}</div>
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
    <tr data-ref="${esc(r.ref)}">
      <td class="guest"><strong>${esc(r.guest)}</strong><span>${esc(r.contact)}</span></td>
      <td class="mono">${esc(r.ref)}</td>
      <td><span class="room-code">${esc(r.room)}</span></td>
      <td style="white-space:nowrap">${esc(resDates(r))}${r.arrival && (r.status === "pending" || r.status === "confirmed") ? `<small class="res-arrival">Arrives ${esc(r.arrival)}</small>` : ""}</td>
      <td>${pill(ST[r.status])}</td>
      <td class="num">${money(r.total)}</td>
      <td class="num" style="${balance(r) > 0 ? "color:var(--danger)" : "color:var(--success)"}">${money(balance(r))}</td>
      <td style="white-space:nowrap;text-align:right">
        ${balance(r) > 0 ? `<button class="btn btn-ghost btn-xs" data-action="charge" data-ref="${esc(r.ref)}" type="button">Charge</button>` : ""}
        <button class="btn btn-ghost btn-xs" data-action="res-detail" data-ref="${esc(r.ref)}" type="button">Open</button>
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
  // Real stays from the reservations list (offsets relative to today), so the
  // calendar always matches Reservations — in demo and live data alike.
  const stayCls = (s) => ({ "checked-in": "checkedin", "checked-out": "confirmed" }[s] || s);
  const demo = {};
  reservations.filter((r) => r.status !== "cancelled" && r.status !== "checked-out").forEach((r) => {
    (demo[r.room] = demo[r.room] || []).push([r.inN, r.outN, r.guest, stayCls(r.status), r.ref]);
  });
  rooms.forEach((r) => {
    html += `<div class="cal-row"><div class="cal-room"><strong>${esc(r.code)} · ${esc(r.name)}</strong><span>${esc(r.type)}</span></div>`;
    days.forEach((d, i) => {
      const n = calOffset + i;
      const isToday = n === 0;
      const stay = (demo[r.code] || []).find(([s, e]) => n >= s && n < e);
      let inner = "";
      if (stay && n === stay[0]) inner = `<div class="stay s-${stay[3]}" data-action="res-detail" data-ref="${esc(stay[4] || stay[2])}">${esc(stay[2])}<small>${dstr(addDays(stay[0]))} → ${dstr(addDays(stay[1]))}</small></div>`;
      else if (stay) inner = `<div class="stay s-${stay[3]}" style="opacity:.45">&nbsp;<small>&nbsp;</small></div>`;
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
let roomTypeFilter = "all"; // room type id, or "all"
function roomMatchesType(r, t) {
  return (r.typeId && r.typeId === t.id) || (!r.typeId && !!t.name && r.typeName === t.name);
}
function renderRoomTypeTabs() {
  const tabs = $("#roomTypeTabs");
  if (!tabs) return;
  if (!roomTypes.length) { tabs.innerHTML = ""; return; }
  if (roomTypeFilter !== "all" && !roomTypes.some((t) => t.id === roomTypeFilter)) roomTypeFilter = "all";
  const btn = (id, label, count) => `<button type="button" role="tab" data-type-filter="${esc(id)}" class="${roomTypeFilter === id ? "active" : ""}">${esc(label)} · ${count}</button>`;
  tabs.innerHTML = btn("all", "All rooms", rooms.length) + roomTypes.map((t) => btn(t.id, t.name, rooms.filter((r) => roomMatchesType(r, t)).length)).join("");
}
function renderRooms() {
  renderRoomTypeTabs();
  const visible = roomTypeFilter === "all" ? rooms : rooms.filter((r) => { const t = roomTypes.find((x) => x.id === roomTypeFilter); return t && roomMatchesType(r, t); });
  if (!rooms.length) {
    $("#roomGrid").innerHTML = `<div class="card card-pad" style="grid-column:1/-1;text-align:center;padding:34px 22px">
      <h3>No rooms yet</h3>
      <p class="hint" style="max-width:460px;margin:8px auto 16px">Add your first cabin or room to set rates, take bookings and appear on your booking page. Room Types first if several units share the same layout.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" data-action="add-room" type="button">Add your first room</button>
        <button class="btn btn-ghost btn-sm" data-action="room-types" type="button">Set up room types</button>
      </div></div>`;
    return;
  }
  if (!visible.length) {
    $("#roomGrid").innerHTML = `<div class="card card-pad" style="grid-column:1/-1;text-align:center;padding:28px 22px"><h3>No rooms of this type yet</h3><p class="hint" style="margin-top:6px">Add a unit and pick this room type, or choose another tab.</p></div>`;
    return;
  }
  $("#roomGrid").innerHTML = visible.map((r) => `
    <div class="card room-card">
      ${r.photos && r.photos.length ? `<img class="room-cover" src="${esc(r.photos[0])}" alt="${esc(r.name)}">` : ""}
      <div class="room-top"><div><h3>${esc(r.code)} · ${esc(r.name)}</h3><div class="meta">${esc(r.type)}</div></div>
        <div class="room-rate"><strong>${money(roomRate(r))}</strong><span>/ night</span></div></div>
      <div class="room-flags">${pill(RSTAT[r.status])}${pill(HK[r.hk])}${r.guest ? `<span class="tag">${esc(r.guest)}</span>` : ""}</div>
      <div style="font-size:12.5px;color:var(--muted)">${esc(r.note)}</div>
      <div class="room-actions">
        <button class="hk-btn${r.hk === "dirty" ? " on-dirty" : ""}" data-hk="${esc(r.code)}|dirty" type="button">Dirty</button>
        <button class="hk-btn${r.hk === "progress" ? " on-progress" : ""}" data-hk="${esc(r.code)}|progress" type="button">In progress</button>
        <button class="hk-btn${r.hk === "clean" ? " on-clean" : ""}" data-hk="${esc(r.code)}|clean" type="button">Clean</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-xs" data-action="edit-room" data-code="${esc(r.code)}" type="button" style="flex:1">Edit</button>
        <button class="btn btn-ghost btn-xs" data-action="room-photos" data-code="${esc(r.code)}" type="button" style="flex:1">Photos${r.photos && r.photos.length ? " (" + r.photos.length + ")" : ""}</button>
        <button class="btn btn-ghost btn-xs" data-action="room-rates" data-code="${esc(r.code)}" type="button" style="flex:1">Rates</button>
      </div>
    </div>`).join("");
}
/* Turnover list: today's and tomorrow's departures and arrivals by room. */
function renderTurnovers() {
  const box = $("#hkTurnovers"); if (!box) return;
  const day = (n) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : dstr(addDays(n)));
  const rows = [];
  turnovers.forEach((t) => {
    if (t.outN === 0 || t.outN === 1) rows.push({ n: t.outN, code: t.roomCode, what: "Check-out", guests: t.guests, done: t.status === "checked-out" });
    if (t.inN === 0 || t.inN === 1) rows.push({ n: t.inN, code: t.roomCode, what: "Arrival", guests: t.guests, done: t.status === "checked-in" });
  });
  rows.sort((a, b) => a.n - b.n || String(a.code).localeCompare(String(b.code)) || (a.what === "Check-out" ? -1 : 1));
  box.innerHTML = `<div class="section-title"><h2>Turnovers</h2><div class="line"></div></div>` + (rows.length
    ? `<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Room</th><th>What</th><th style="text-align:right">Guests</th></tr></thead><tbody>` +
      rows.map((r) => `<tr style="cursor:default"><td>${day(r.n)}</td><td><span class="room-code">${esc(r.code)}</span>${roomByCode(r.code) ? " " + esc(roomByCode(r.code).name) : ""}</td>
        <td>${r.what}${r.done ? ` <span class="pill clean"><i></i>${r.what === "Arrival" ? "checked in" : "checked out"}</span>` : ""}</td><td class="num">${r.guests || "-"}</td></tr>`).join("") +
      `</tbody></table></div>`
    : `<p class="hint">No check-outs or arrivals today or tomorrow.</p>`);
}
function renderHK() {
  renderTurnovers();
  const cols = [["dirty", "Dirty · needs cleaning"], ["progress", "In progress"], ["clean", "Clean · ready"]];
  $("#hkBoard").innerHTML = cols.map(([key, label]) => {
    const list = rooms.filter((r) => r.hk === key);
    return `<div class="hk-col"><header>${label}<span class="n">${list.length}</span></header>` +
      (list.map((r) => `
        <div class="hk-card"><strong>${esc(r.code)} · ${esc(r.name)}</strong><p>${esc(r.note)}</p>
          <div class="hk-move">
            ${key !== "dirty" ? `<button class="btn btn-ghost btn-xs" data-hk="${esc(r.code)}|dirty" type="button">← Dirty</button>` : ""}
            ${key === "dirty" ? `<button class="btn btn-primary btn-xs" data-hk="${esc(r.code)}|progress" type="button">Start →</button>` : ""}
            ${key === "progress" ? `<button class="btn btn-primary btn-xs" data-hk="${esc(r.code)}|clean" type="button">Mark clean ✓</button>` : ""}
            ${key === "clean" ? `<button class="btn btn-ghost btn-xs" data-hk="${esc(r.code)}|dirty" type="button">Flag dirty</button>` : ""}
          </div></div>`).join("") || `<div class="empty" style="padding:18px">Nothing here.</div>`) + `</div>`;
  }).join("");
}
/* ---------------- Maintenance ---------------- */
function renderMaintenance() {
  const board = $("#maintBoard"); if (!board) return;
  const cols = [["open", "Open · needs attention"], ["in_progress", "In progress"], ["done", "Done"]];
  const prioPill = (p) => p === "high" ? `<span class="pill" style="background:#fde8e8;color:#8c2b2b">High</span>` : p === "low" ? `<span class="pill">Low</span>` : `<span class="pill">Normal</span>`;
  board.innerHTML = cols.map(([key, label]) => {
    const list = tickets.filter((t) => t.status === key);
    return `<div class="hk-col"><header>${label}<span class="n">${list.length}</span></header>` +
      (list.map((t) => `
        <div class="hk-card"><strong>${esc(t.title)}</strong>
          <p>${t.roomCode ? esc(t.roomCode) + " · " : ""}${esc(t.when || "")}</p>
          ${t.desc ? `<p>${esc(t.desc)}</p>` : ""}
          ${t.photo ? `<img src="${esc(t.photo)}" alt="Ticket photo" style="width:100%;border-radius:8px;margin:6px 0">` : ""}
          <div style="margin:4px 0 8px">${prioPill(t.priority)}</div>
          <div class="hk-move">
            ${key === "open" ? `<button class="btn btn-primary btn-xs" data-action="ticket-status" data-id="${t.id}" data-status="in_progress" type="button">Start →</button>` : ""}
            ${key === "in_progress" ? `<button class="btn btn-primary btn-xs" data-action="ticket-status" data-id="${t.id}" data-status="done" type="button">Mark done ✓</button>` : ""}
            ${key !== "open" ? `<button class="btn btn-ghost btn-xs" data-action="ticket-status" data-id="${t.id}" data-status="open" type="button">← Reopen</button>` : ""}
            <button class="btn btn-ghost btn-xs" data-action="del-ticket" data-id="${t.id}" type="button">Delete</button>
          </div></div>`).join("") || `<div class="empty" style="padding:18px">Nothing here.</div>`) + `</div>`;
  }).join("");
  const openCount = tickets.filter((t) => t.status !== "done").length;
  const badge = $("#navMaintBadge");
  if (badge) { badge.hidden = !openCount; badge.textContent = openCount; }
}

/* ---------------- External calendars (iCal sync) ---------------- */
function icalExportBase() {
  const c = window.SH_CONFIG || {};
  return (c.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/ical-export";
}
function renderIcal() {
  const urlInput = $("#icalExportUrl");
  if (urlInput) urlInput.value = liveSlug && liveIcalToken ? `${icalExportBase()}?property=${encodeURIComponent(liveSlug)}&token=${encodeURIComponent(liveIcalToken)}` : "Sign in with your property account to get your calendar link";
  const roomSel = $("#icalRoom");
  if (roomSel) {
    const html = rooms.map((r) => `<option value="${r.id || ""}" data-code="${esc(r.code)}">${esc(r.code)} · ${esc(r.name)}</option>`).join("");
    if (roomSel.innerHTML !== html) { const keep = roomSel.value; roomSel.innerHTML = html; if (keep) roomSel.value = keep; }
  }
  const list = $("#icalFeedList");
  if (list) {
    list.innerHTML = icalFeeds.length ? icalFeeds.map((f) => `
      <div class="kv-row" style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${esc(f.name)}</strong> <span class="pill">${esc(f.source)}</span> <span style="color:var(--muted);font-size:12.5px">${esc(f.roomCode)} · ${f.lastError ? "Last sync failed: " + esc(f.lastError) : f.lastSynced ? "Synced " + new Date(f.lastSynced).toLocaleString() : "Not synced yet"}</span></div>
        <button class="btn btn-ghost btn-xs" data-action="sync-feed" data-id="${f.id}" type="button">Sync now</button>
        <button class="btn btn-ghost btn-xs" data-action="del-feed" data-id="${f.id}" type="button">Remove</button>
      </div>`).join("") : `<div class="empty" style="padding:14px">No external calendars yet. Add your Airbnb or Vrbo calendar below.</div>`;
  }
  const note = $("#icalLiveNote");
  if (note) note.textContent = window.SHDB && SHDB.hasLive() ? "" : "Demo mode: sign in with your property account to add live calendars.";
}

/* Front-desk confirmation codes: random, from the same unambiguous alphabet
   the booking page's server codes use (a counter collided across devices). */
function newRef(prefix) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join("");
}

/* Invoke an Edge Function with the signed-in user's token (falls back to anon key). */
async function fnInvoke(name, body) {
  const c = window.SH_CONFIG || {};
  const token = (window.SHDB && SHDB.freshToken) ? await SHDB.freshToken() : (localStorage.getItem("sh_access_token") || c.SUPABASE_ANON_KEY);
  const res = await fetch((c.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/" + name, {
    method: "POST",
    headers: { apikey: c.SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || ("Function " + name + " failed (" + res.status + ")"));
  return d;
}

const ratePrevBtn = $("#ratePrev"), rateNextBtn = $("#rateNext"), rateTodayBtn2 = $("#rateTodayBtn"), rateRoomSel = $("#rateRoom");
if (ratePrevBtn) ratePrevBtn.addEventListener("click", () => { ratesMonthOff--; renderRates(); });
if (rateNextBtn) rateNextBtn.addEventListener("click", () => { ratesMonthOff++; renderRates(); });
if (rateTodayBtn2) rateTodayBtn2.addEventListener("click", () => { ratesMonthOff = 0; renderRates(); });
if (rateRoomSel) rateRoomSel.addEventListener("change", () => { ratesTypeId = rateRoomSel.value; renderRates(); });
const pfPolicySel = $("#pfPolicy");
if (pfPolicySel) pfPolicySel.addEventListener("change", () => {
  const wrap = $("#pfPolicyCustomWrap");
  if (wrap) { wrap.hidden = pfPolicySel.selectedIndex !== 3; if (!wrap.hidden) { const t = $("#pfPolicyText"); if (t) t.focus(); } }
});
const rmtTypesEl = $("#rmtTypes");
if (rmtTypesEl) rmtTypesEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-rmt-type]"); if (!b) return;
  ratesTypeId = b.dataset.rmtType;
  renderRateMgmt();
});
const roomTypeTabsEl = $("#roomTypeTabs");
if (roomTypeTabsEl) roomTypeTabsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-type-filter]"); if (!b) return;
  roomTypeFilter = b.dataset.typeFilter;
  renderRooms();
});
const repRange = $("#repRange");
if (repRange) repRange.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  reportDays = parseInt(b.dataset.days, 10) || 30;
  $$("#repRange button").forEach((x) => x.classList.toggle("active", x === b));
  renderReports();
});
/* Audit bindings: segmented toggles, property picker, logo upload */
$$(".seg").forEach((seg) => {
  if (seg.id === "resFilter" || seg.id === "repRange" || seg.id === "roomTypeTabs") return;
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $$("button", seg).forEach((x) => x.classList.toggle("active", x === b));
  });
});
const propPickerBtn = $("#propPicker");
if (propPickerBtn) propPickerBtn.addEventListener("click", () => {
  if (window.SHDB && SHDB.hasLive()) openPropertySwitcher(); else goto("settings");
});
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
  renderRooms(); renderHK(); renderMiniRooms(); renderOverview();
  if (window.SHDB) SHDB.updateHK(r);
  toast(`${code} marked ${HK[hk][1].toLowerCase()}`, r.name, hk === "clean" ? "ok" : "");
});

/* ---------------- Room types, editing, rate calendar, photos ---------------- */
function typeRoomCount(t) {
  return rooms.filter((r) => (r.typeId && r.typeId === t.id) || (!r.typeId && r.typeName === t.name)).length;
}
function rtSummary(t) {
  const bits = [];
  if (t.bathrooms) bits.push(t.bathrooms + " bath");
  if (t.view) bits.push(t.view);
  if (t.maxOccupants) bits.push("max " + t.maxOccupants + " guests");
  if (t.rackRate) bits.push("nightly " + money(t.rackRate));
  if (t.beds && t.beds.length) bits.push(t.beds.reduce((n, b) => n + (Number(b.qty) || 0), 0) + " bed(s)");
  if (t.features && t.features.length) bits.push(t.features.length + " features");
  if (t.ratePlans && t.ratePlans.length) bits.push(t.ratePlans.length + " rate plan(s)");
  if (t.photos && t.photos.length) bits.push(t.photos.length + " photo(s)");
  if (t.handicapAccessible) bits.push("accessible");
  return bits.join(" · ");
}
function bedRowHtml(bed) {
  const b = bed || { qty: 1, type: "Queen" };
  const types = RT_BED_TYPES.includes(b.type) ? RT_BED_TYPES : [b.type, ...RT_BED_TYPES];
  return `<div class="bed-row"><input class="input rt-bed-qty" type="number" min="1" max="20" value="${Number(b.qty) || 1}" aria-label="Number of beds">
    <select class="select rt-bed-type" aria-label="Bed type">${types.map((x) => `<option ${x === b.type ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
    <button class="btn btn-ghost btn-xs" data-action="rt-bed-del" type="button">Remove</button></div>`;
}
function checkGridHtml(id, items, selected) {
  const sel = new Set(selected || []);
  return `<div class="check-grid" id="${id}">${items.map((f) => `<label class="check-item"><input type="checkbox" value="${esc(f)}" ${sel.has(f) ? "checked" : ""}><span>${esc(f)}</span></label>`).join("")}</div>`;
}
function openRoomTypes(editId) {
  const editing = editId ? normalizeRoomType(roomTypes.find((t) => t.id === editId)) : normalizeRoomType({});
  const isEdit = !!editId;
  const num = (v) => (v === 0 || v ? v : "");
  openModal({
    title: "Room types", sub: "Guest-facing details, occupancy, rates and features for each type",
    body: `
      <div class="row-list" style="margin-bottom:6px">
        ${roomTypes.map((t, i) => `
          <div class="row-item"><div class="ri-main"><strong>${esc(t.name)}</strong><span>${esc(rtSummary(normalizeRoomType(t)) || t.desc || "No details yet")}</span></div>
            <div class="ri-right" style="display:flex;gap:6px;align-items:center"><span class="tag">${typeRoomCount(t)} rooms</span>
            <button class="btn btn-ghost btn-xs" data-action="rt-rates" data-i="${i}" type="button">Rates${t.ratePlans && t.ratePlans.length ? " (" + t.ratePlans.length + ")" : ""}</button>
            <button class="btn btn-ghost btn-xs" data-action="rt-photos" data-i="${i}" type="button">Photos${t.photos && t.photos.length ? " (" + t.photos.length + ")" : ""}</button>
            <button class="btn btn-ghost btn-xs" data-action="rt-edit" data-i="${i}" type="button">Edit</button>
            <button class="btn btn-ghost btn-xs" data-action="rt-del" data-i="${i}" type="button">Delete</button></div></div>`).join("") || `<p class="hint">No room types yet. Add your first below.</p>`}
      </div>

      <h4 class="rt-sec">${isEdit ? "Edit" : "New"} room type</h4>
      <div class="form-2">
        <div class="field"><label>Type name</label><input class="input" id="rtName" value="${isEdit ? esc(editing.name || "") : ""}" placeholder="e.g. Cabin"></div>
        <div class="field"><label>Bathrooms</label><input class="input" id="rtBathrooms" type="number" min="0" step="0.5" value="${editing.bathrooms}"></div>
      </div>
      <div class="field"><label>Description</label><textarea class="textarea" id="rtDesc" placeholder="Short guest-facing text shown on your booking page">${isEdit ? esc(editing.desc || "") : ""}</textarea></div>
      <div class="form-2">
        <div class="field"><label>Room view</label><select class="select" id="rtView">${RT_VIEWS.map((v) => `<option value="${esc(v)}" ${v === editing.view ? "selected" : ""}>${v || "Select a view…"}</option>`).join("")}</select></div>
        <div class="field"><label>Smoking policy</label><select class="select" id="rtSmoking">${RT_SMOKING.map(([v, l]) => `<option value="${v}" ${v === editing.smoking ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>

      <h4 class="rt-sec">Stay &amp; rates (defaults)</h4>
      <div class="form-3">
        <div class="field"><label>Min stay (nights)</label><input class="input" id="rtMinStay" type="number" min="0" value="${editing.minStay}"></div>
        <div class="field"><label>Max stay (nights)</label><input class="input" id="rtMaxStay" type="number" min="0" value="${num(editing.maxStay)}" placeholder="No limit"></div>
        <div class="field"><label>Nightly rate (${moneyCurrency}/night)</label><input class="input mono" id="rtRackRate" type="number" min="0" step="0.01" value="${num(editing.rackRate)}" placeholder="0.00"><span class="help">Every room of this type sells at this rate unless a date override applies.</span></div>
      </div>
      <div class="form-3">
        <div class="field"><label>Extra adult (${moneyCurrency}/night)</label><input class="input mono" id="rtExtraAdult" type="number" min="0" step="0.01" value="${num(editing.extraAdultRate)}" placeholder="0.00"></div>
        <div class="field"><label>Extra child (${moneyCurrency}/night)</label><input class="input mono" id="rtExtraChild" type="number" min="0" step="0.01" value="${num(editing.extraChildRate)}" placeholder="0.00"></div>
        <div class="field"><label>Extra infant (${moneyCurrency}/night)</label><input class="input mono" id="rtExtraInfant" type="number" min="0" step="0.01" value="${num(editing.extraInfantRate)}" placeholder="0.00"></div>
      </div>

      <h4 class="rt-sec">Occupancies</h4>
      <div class="form-3">
        <div class="field"><label>Included adults</label><input class="input" id="rtIncAdults" type="number" min="0" value="${editing.includedAdults}"><span class="help">Covered by the base rate (default 2)</span></div>
        <div class="field"><label>Included children</label><input class="input" id="rtIncChildren" type="number" min="0" value="${editing.includedChildren}"></div>
        <div class="field"><label>Included infants</label><input class="input" id="rtIncInfants" type="number" min="0" value="${editing.includedInfants}"></div>
      </div>
      <div class="form-3">
        <div class="field"><label>Max adults</label><input class="input" id="rtMaxAdults" type="number" min="0" value="${num(editing.maxAdults)}" placeholder="No limit"></div>
        <div class="field"><label>Max children</label><input class="input" id="rtMaxChildren" type="number" min="0" value="${num(editing.maxChildren)}" placeholder="No limit"></div>
        <div class="field"><label>Max infants</label><input class="input" id="rtMaxInfants" type="number" min="0" value="${num(editing.maxInfants)}" placeholder="No limit"></div>
      </div>
      <div class="form-2">
        <div class="field"><label>Max occupants (total)</label><input class="input" id="rtMaxOccupants" type="number" min="0" value="${num(editing.maxOccupants)}" placeholder="No limit"></div>
        <div class="field"><label>Adults required (minimum)</label><input class="input" id="rtAdultsRequired" type="number" min="0" value="${editing.adultsRequired}"><span class="help">At least this many adults per booking</span></div>
      </div>

      <h4 class="rt-sec">Beds</h4>
      <div id="rtBeds">${(editing.beds.length ? editing.beds : [{ qty: 1, type: "Queen" }]).map(bedRowHtml).join("")}</div>
      <button class="btn btn-ghost btn-sm" data-action="rt-bed-add" type="button">+ Add a bed</button>

      <h4 class="rt-sec">Accessibility</h4>
      <label class="check-item rt-access-toggle"><input type="checkbox" id="rtHandicap" ${editing.handicapAccessible ? "checked" : ""}><span><strong>Handicap / wheelchair accessible</strong></span></label>
      <div class="field" style="margin-top:10px"><label>Accessible features</label>${checkGridHtml("rtAccessGrid", RT_ACCESS_FEATURES, editing.accessibleFeatures)}</div>

      <h4 class="rt-sec">Features &amp; amenities</h4>
      <div class="field"><input class="input" id="rtFeatureSearch" type="search" placeholder="Filter features… (e.g. bath, tv, plates)"><span class="help">Tick everything this room type includes — shown on your booking page.</span></div>
      ${checkGridHtml("rtFeatureGrid", RT_FEATURES, editing.features)}
      <p class="hint" style="margin-top:12px">Rate plans (extended-stay discounts, promo-code rates) and photos live behind the Rates and Photos buttons next to the type above. Type photos are the fallback on the booking page when a room has none of its own.</p>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Close</button>
      <button class="btn btn-primary btn-sm" data-action="rt-save" data-edit="${isEdit ? editing.id : ""}" type="button">${isEdit ? "Save type" : "Add type"}</button>`,
    wide: true
  });
  const search = $("#rtFeatureSearch");
  if (search) search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    $$("#rtFeatureGrid .check-item").forEach((el) => { el.style.display = !q || el.textContent.toLowerCase().includes(q) ? "" : "none"; });
  });
}
function openRoomTypePhotos(id) {
  const t = roomTypes.find((x) => x.id === id);
  if (!t) return;
  t.photos = Array.isArray(t.photos) ? t.photos : [];
  openModal({
    title: `Photos · ${t.name}`, sub: "Type photos show on the booking page when a room has none of its own",
    body: `
      <div class="photo-grid">${t.photos.map((p, i) => `<figure><img src="${esc(p)}" alt=""><button type="button" data-action="rt-photo-del" data-id="${esc(t.id)}" data-i="${i}" aria-label="Remove photo">✕</button></figure>`).join("") || `<p class="hint">No photos yet. Upload the first below.</p>`}</div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center">
        <label class="btn btn-primary btn-sm" for="rtPhotoFile" style="cursor:pointer">Upload photos</label>
        <input type="file" id="rtPhotoFile" accept="image/*" multiple hidden>
        <span class="help" style="font-size:12px;color:var(--faint)">JPG or PNG, up to 5 MB each</span>
      </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Done</button>`,
    wide: true
  });
  $("#rtPhotoFile").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    for (const f of files) {
      if (f.size > 5 * 1024 * 1024) { toast("Skipped a large photo", f.name + " is over 5 MB", "warn"); continue; }
      try {
        let url;
        if (window.SHDB && SHDB.hasLive() && t.id && !String(t.id).startsWith("demo-") && !String(t.id).startsWith("local-")) {
          url = await SHDB.uploadPublic("room-photos", `${SHDB.tenantId()}/types/${t.id}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`, f);
        } else {
          url = URL.createObjectURL(f);
          toast("Photo preview only", "Sign in live to save photos to your property", "warn");
        }
        t.photos.push(url);
      } catch { toast("Upload failed", f.name, "err"); }
    }
    if (window.SHDB && SHDB.hasLive() && t.id && !String(t.id).startsWith("demo-") && !String(t.id).startsWith("local-")) SHDB.updateRoomType(t.id, normalizeRoomType(t)).catch(() => toast("Photos saved locally only", "Storage sync failed", "warn"));
    openRoomTypePhotos(t.id);
  });
}
function persistRoomType(t) {
  if (window.SHDB && SHDB.hasLive() && t.id && !String(t.id).startsWith("demo-") && !String(t.id).startsWith("local-")) {
    SHDB.updateRoomType(t.id, normalizeRoomType(t)).catch(() => toast("Saved locally only", "Supabase write failed", "warn"));
  }
}
function planSummary(p) {
  const diff = p.rateKind === "flat" ? money(p.difference) + "/night" : (p.difference > 0 ? "+" : "") + p.difference + "%";
  const bits = [diff, (p.minStay || 1) + "–" + (p.maxStay || "∞") + " nights"];
  if (p.releasePeriod) bits.push("book " + p.releasePeriod + "+ days ahead");
  if (p.promoCode) bits.push("code " + p.promoCode);
  return bits.join(" · ");
}

/* ---------------- Rates management page (rate plans per room type) ---------------- */
let ratesTypeId = null;   // room type selected on the Rates page
let rtpCtx = "modal";     // where the rate plan editor was opened from: "modal" | "page"
let rtpTypeId = null;     // room type the open plan editor belongs to
function planReturn() {
  if (rtpCtx === "page") { closeModal(); renderRateMgmt(); renderRooms(); }
  else openRoomTypeRates(rtpTypeId);
}
/* The rate entered when a room type is created IS its Default Rate: nightly
   price, stay defaults, extra-guest charges and included occupants from the
   type itself. Extra rates (extended stay, promo...) sit alongside it. */
function defaultRateSummary(t) {
  const tn = normalizeRoomType(t);
  const bits = [money(typeBaseRate(t)) + "/night", (tn.minStay || 1) + "–" + (tn.maxStay || "∞") + " nights"];
  if (tn.extraAdultRate) bits.push("extra adult " + money(tn.extraAdultRate));
  if (tn.extraChildRate) bits.push("extra child " + money(tn.extraChildRate));
  if (tn.extraInfantRate) bits.push("extra infant " + money(tn.extraInfantRate));
  bits.push("includes " + (tn.includedAdults || 0) + " adult" + (tn.includedAdults === 1 ? "" : "s") + (tn.includedChildren ? " + " + tn.includedChildren + " child" + (tn.includedChildren === 1 ? "" : "ren") : "") + (tn.includedInfants ? " + " + tn.includedInfants + " infant" + (tn.includedInfants === 1 ? "" : "s") : ""));
  if (tn.maxOccupants) bits.push("max " + tn.maxOccupants + " guests");
  return bits.join(" · ");
}
function defaultRateRow(t) {
  return `<div class="row-item" style="border-color:var(--brand)"><div class="ri-main"><strong>Default Rate</strong><span>${esc(defaultRateSummary(t))}</span></div>
    <div class="ri-right" style="display:flex;gap:6px;align-items:center">
    <span class="pill confirmed"><i></i>Default · Public</span>
    <button class="btn btn-ghost btn-xs" data-action="rmt-default-edit" data-type="${esc(t.id)}" type="button">Edit</button></div></div>`;
}

function renderRateMgmt() {
  const wrap = $("#rmtPlans"); if (!wrap) return;
  const typesEl = $("#rmtTypes");
  if (!roomTypes.length) {
    if (typesEl) typesEl.innerHTML = "";
    wrap.innerHTML = `<div style="text-align:center;padding:22px"><h3>No room types yet</h3><p class="hint" style="margin:8px auto 14px;max-width:420px">Rates belong to room types. Create a type first, then add its rates here.</p><button class="btn btn-primary btn-sm" data-action="room-types" type="button">Set up room types</button></div>`;
    return;
  }
  if (!ratesTypeId || !roomTypes.some((t) => t.id === ratesTypeId)) ratesTypeId = roomTypes[0].id;
  if (typesEl) typesEl.innerHTML = roomTypes.map((t) => {
    const n = normalizeRoomType(t).ratePlans.length;
    return `<button type="button" role="tab" data-rmt-type="${esc(t.id)}" class="${t.id === ratesTypeId ? "active" : ""}">${esc(t.name)} · ${n} rate${n === 1 ? "" : "s"}</button>`;
  }).join("");
  const t = roomTypes.find((x) => x.id === ratesTypeId);
  const tn = normalizeRoomType(t);
  wrap.innerHTML = `
    <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px">
      <h3 style="font-size:16px">${esc(t.name)}</h3>
      <span style="color:var(--muted);font-size:13px">Every room of this type books on the Default Rate unless a better rate below applies</span>
    </div>
    <div class="row-list">
      ${defaultRateRow(t)}
      ${tn.ratePlans.map((pl) => `
        <div class="row-item"><div class="ri-main"><strong>${esc(pl.name)}</strong><span>${esc(planSummary(pl))}${pl.desc ? " — " + esc(pl.desc) : ""}</span></div>
          <div class="ri-right" style="display:flex;gap:6px;align-items:center">
          ${pl.promoCode ? `<span class="pill progress"><i></i>Promo ${esc(pl.promoCode)}</span>` : `<span class="pill confirmed"><i></i>Public</span>`}
          <button class="btn btn-ghost btn-xs" data-action="rmt-edit" data-type="${esc(t.id)}" data-plan="${esc(pl.id)}" type="button">Edit</button>
          <button class="btn btn-ghost btn-xs" data-action="rtp-del" data-type="${esc(t.id)}" data-plan="${esc(pl.id)}" type="button">Delete</button></div></div>`).join("") || `<p class="hint" style="padding:8px 0">No extra rates yet — every booking uses the Default Rate above. Add one, e.g. an Extended stay rate at −10% for 3+ nights.</p>`}
    </div>`;
}
function openRoomTypeRates(typeId, planId, fromPage) {
  const t = roomTypes.find((x) => x.id === typeId);
  if (!t) return;
  rtpCtx = fromPage ? "page" : "modal";
  rtpTypeId = t.id;
  const tn = normalizeRoomType(t);
  const editing = planId ? tn.ratePlans.find((p) => p.id === planId) : null;
  const p = editing || normalizeRatePlan({});
  const isEdit = !!editing;
  const blank = (v) => (v == null ? "" : v);
  openModal({
    title: `Rate plans · ${t.name}`, sub: "Different prices for longer stays, early bookers or promo codes — based on each room's nightly rate",
    body: `
      ${fromPage ? "" : `<div class="row-list" style="margin-bottom:6px">
        ${defaultRateRow(t)}
        ${tn.ratePlans.map((pl) => `
          <div class="row-item"><div class="ri-main"><strong>${esc(pl.name)}</strong><span>${esc(planSummary(pl))}</span></div>
            <div class="ri-right" style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-ghost btn-xs" data-action="rtp-edit" data-type="${esc(t.id)}" data-plan="${esc(pl.id)}" type="button">Edit</button>
            <button class="btn btn-ghost btn-xs" data-action="rtp-del" data-type="${esc(t.id)}" data-plan="${esc(pl.id)}" type="button">Delete</button></div></div>`).join("") || `<p class="hint">No rate plans yet — every booking uses the standard rate. Add your first below (e.g. an extended-stay discount).</p>`}
      </div>`}

      <h4 class="rt-sec">${isEdit ? "Edit" : "New"} rate plan</h4>
      <div class="field"><label>Plan name *</label><input class="input" id="rpName" value="${isEdit ? esc(p.name) : ""}" placeholder="e.g. Extended stay rate"><span class="help">This is the rate name that displays to online customers when it applies.</span></div>
      <div class="field"><label>Description</label><textarea class="textarea" id="rpDesc" placeholder="e.g. Enjoy 10% off when booking for more than three nights.">${isEdit ? esc(p.desc) : ""}</textarea></div>
      <div class="form-3">
        <div class="field"><label>Default minimum stay *</label><input class="input" id="rpMinStay" type="number" min="0" value="${p.minStay}"></div>
        <div class="field"><label>Default maximum stay</label><input class="input" id="rpMaxStay" type="number" min="0" value="${p.maxStay || ""}" placeholder="No limit"></div>
        <div class="field"><label>Release period (days)</label><input class="input" id="rpRelease" type="number" min="0" value="${p.releasePeriod || ""}" placeholder="0"><span class="help">Booking must be made at least this many days in advance.</span></div>
      </div>

      <h4 class="rt-sec">Rates</h4>
      <div class="form-3">
        <div class="field"><label>Rate type</label><select class="select" id="rpKind"><option value="percent" ${p.rateKind === "percent" ? "selected" : ""}>% difference</option><option value="flat" ${p.rateKind === "flat" ? "selected" : ""}>${esc(SHMoney.symbol(moneyCurrency))} difference / night</option></select></div>
        <div class="field"><label>Difference *</label><input class="input mono" id="rpDiff" type="number" step="0.1" value="${p.difference}"><span class="help">Use a negative number for a discount, e.g. -10.</span></div>
        <div class="field"><label>Extra adult rate *</label><input class="input mono" id="rpExtraAdult" type="number" min="0" step="0.01" value="${p.extraAdultRate}"></div>
      </div>
      <div class="form-2">
        <div class="field"><label>Extra child rate *</label><input class="input mono" id="rpExtraChild" type="number" min="0" step="0.01" value="${p.extraChildRate}"></div>
        <div class="field"><label>Extra infant rate *</label><input class="input mono" id="rpExtraInfant" type="number" min="0" step="0.01" value="${p.extraInfantRate}"></div>
      </div>

      <h4 class="rt-sec">Occupancies</h4>
      <div class="form-3">
        <div class="field"><label>Included occupants</label><input class="input" id="rpIncOcc" type="number" min="0" value="${blank(p.includedOccupants)}" placeholder="Use type default"></div>
        <div class="field"><label>Maximum adults</label><input class="input" id="rpMaxAdults" type="number" min="0" value="${blank(p.maxAdults)}" placeholder="Use type default"></div>
        <div class="field"><label>Maximum children</label><input class="input" id="rpMaxChildren" type="number" min="0" value="${blank(p.maxChildren)}" placeholder="Use type default"></div>
      </div>
      <div class="form-2">
        <div class="field"><label>Maximum infants</label><input class="input" id="rpMaxInfants" type="number" min="0" value="${blank(p.maxInfants)}" placeholder="Use type default"><span class="help">Number of infants do not count towards the maximum number of occupants.</span></div>
        <div class="field"><label>Maximum occupants</label><input class="input" id="rpMaxOcc" type="number" min="0" value="${blank(p.maxOccupants)}" placeholder="Use type default"></div>
      </div>

      <h4 class="rt-sec">Promotional code</h4>
      <label class="check-item"><input type="checkbox" id="rpPromoOnly" ${p.promoCode ? "checked" : ""}><span><strong>Show only when a linked promotional code is entered</strong></span></label>
      <div class="field" id="rpPromoWrap" ${p.promoCode ? "" : "hidden"} style="margin-top:10px"><label>Promotion code</label><input class="input mono" id="rpPromo" value="${isEdit ? esc(p.promoCode) : ""}" placeholder="e.g. EXTENDED_STAY" style="text-transform:uppercase"><span class="help">Guests enter this on your booking page, or arrive with <span class="mono">?PROMO=CODE</span> in the link. Until then this rate stays hidden.</span></div>`,
    foot: `${fromPage
      ? `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>`
      : `<button class="btn btn-ghost btn-sm" data-action="rtp-back" data-type="${esc(t.id)}" type="button">Back to type</button>`}
      <button class="btn btn-primary btn-sm" data-action="rtp-save" data-type="${esc(t.id)}" data-plan="${isEdit ? esc(p.id) : ""}" type="button">${isEdit ? "Save rate plan" : "Add rate plan"}</button>`,
    wide: true
  });
  const promoOnly = $("#rpPromoOnly");
  if (promoOnly) promoOnly.addEventListener("change", () => {
    const wrap = $("#rpPromoWrap");
    if (wrap) { wrap.hidden = !promoOnly.checked; if (promoOnly.checked) { const inp = $("#rpPromo"); if (inp) inp.focus(); } }
  });
}
function readRatePlanForm() {
  const val = (sel) => { const el = $(sel); return el ? el.value.trim() : ""; };
  const intOr = (sel, d) => { const v = parseInt(val(sel), 10); return Number.isFinite(v) ? v : d; };
  const intOrNull = (sel) => { const v = parseInt(val(sel), 10); return Number.isFinite(v) ? v : null; };
  const moneyOr0 = (sel) => { const v = parseFloat(val(sel)); return Number.isFinite(v) ? v : 0; };
  return normalizeRatePlan({
    name: val("#rpName"), desc: val("#rpDesc"),
    minStay: intOr("#rpMinStay", 1), maxStay: intOr("#rpMaxStay", 0), releasePeriod: intOr("#rpRelease", 0),
    rateKind: val("#rpKind") || "percent",
    difference: (() => { const v = parseFloat(val("#rpDiff")); return Number.isFinite(v) ? v : 0; })(),
    extraAdultRate: moneyOr0("#rpExtraAdult"), extraChildRate: moneyOr0("#rpExtraChild"), extraInfantRate: moneyOr0("#rpExtraInfant"),
    includedOccupants: intOrNull("#rpIncOcc"), maxAdults: intOrNull("#rpMaxAdults"), maxChildren: intOrNull("#rpMaxChildren"),
    maxInfants: intOrNull("#rpMaxInfants"), maxOccupants: intOrNull("#rpMaxOcc"),
    promoCode: ($("#rpPromoOnly") && $("#rpPromoOnly").checked) ? val("#rpPromo").toUpperCase() : ""
  });
}
function readRoomTypeForm() {
  const checked = (grid) => $$("#" + grid + " input:checked").map((el) => el.value);
  const val = (sel) => { const el = $(sel); return el ? el.value.trim() : ""; };
  const intVal = (sel, d) => { const v = parseInt(val(sel), 10); return Number.isFinite(v) ? v : d; };
  const moneyVal = (sel) => { const v = parseFloat(val(sel)); return Number.isFinite(v) && v > 0 ? v : 0; };
  return normalizeRoomType({
    name: val("#rtName"), desc: val("#rtDesc"),
    bathrooms: parseFloat(val("#rtBathrooms")) || 1,
    view: val("#rtView"), smoking: val("#rtSmoking") || "non-smoking",
    minStay: intVal("#rtMinStay", 1), maxStay: intVal("#rtMaxStay", 0),
    rackRate: moneyVal("#rtRackRate"),
    extraAdultRate: moneyVal("#rtExtraAdult"), extraChildRate: moneyVal("#rtExtraChild"), extraInfantRate: moneyVal("#rtExtraInfant"),
    includedAdults: intVal("#rtIncAdults", 2), includedChildren: intVal("#rtIncChildren", 0), includedInfants: intVal("#rtIncInfants", 0),
    maxAdults: intVal("#rtMaxAdults", 0), maxChildren: intVal("#rtMaxChildren", 0), maxInfants: intVal("#rtMaxInfants", 0),
    maxOccupants: intVal("#rtMaxOccupants", 0), adultsRequired: intVal("#rtAdultsRequired", 1),
    beds: $$("#rtBeds .bed-row").map((row) => ({ qty: Math.max(1, parseInt($(".rt-bed-qty", row).value, 10) || 1), type: $(".rt-bed-type", row).value })).filter((b) => b.type),
    handicapAccessible: !!($("#rtHandicap") && $("#rtHandicap").checked),
    accessibleFeatures: checked("rtAccessGrid"), features: checked("rtFeatureGrid")
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
      <div class="form-2">
        <div class="field"><label>Code</label><input class="input mono" value="${esc(r.code)}" disabled></div>
        <div class="field"><label>Nightly rate &amp; sleeps</label><input class="input" value="${money(roomRate(r))} · sleeps ${r.sleeps || 2} (from type)" disabled><span class="help">Pricing and occupancy live on the room type — edit them there.</span></div>
      </div>
      <div class="field"><label>Notes</label><input class="input" id="erNotes" value="${esc(r.note || "")}" placeholder="Internal note shown on the room card"></div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="save-edit-room" data-code="${esc(r.code)}" type="button">Save room</button>`
  });
}
function ratesType() {
  if (!ratesTypeId || !roomTypes.some((t) => t.id === ratesTypeId)) ratesTypeId = roomTypes.length ? roomTypes[0].id : null;
  return ratesTypeId ? roomTypes.find((t) => t.id === ratesTypeId) : null;
}
function renderRates() {
  const sel = $("#rateRoom");
  if (!sel) return;
  const type = ratesType();
  sel.innerHTML = roomTypes.map((t) => `<option value="${esc(t.id)}" ${type && t.id === type.id ? "selected" : ""}>${esc(t.name)} (nightly ${money(typeBaseRate(t))})</option>`).join("");
  if (!type) { $("#rateGrid").innerHTML = `<p class="hint">Create a room type first — nightly rates and date rules live on room types, and every room of that type inherits them.</p>`; return; }
  const baseRate = typeBaseRate(type);
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
    const o = ovForType(type, iso);
    const flags = [];
    if (o && o.minStay) flags.push("min " + o.minStay + "n");
    if (o && o.cta) flags.push("CTA");
    if (o && o.ctd) flags.push("CTD");
    html += `<button type="button" class="rate-day${o ? " over" : ""}${o && o.closed ? " closed" : ""}${iso === todayIso ? " today" : ""}${iso < todayIso ? " past" : ""}" data-rate-date="${iso}">
      <div class="d">${dt.toLocaleDateString("en-US", { weekday: "short" })} ${d}</div>
      <div class="p">${o && o.closed ? "Closed" : money(o && o.rate != null ? o.rate : baseRate)}</div>
      <div class="t">${o && o.closed ? "Stop sell" : o ? "Override" : "Default"}${flags.length ? " · " + flags.join(" ") : ""}</div></button>`;
  }
  $("#rateGrid").innerHTML = html;
}
function openRateDay(iso) {
  const type = ratesType();
  if (!type) return;
  const o = ovForType(type, iso);
  const has = !!o;
  const prev = o || { rate: typeBaseRate(type), minStay: null, maxStay: null, closed: false, cta: false, ctd: false };
  const pretty = new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const triState = (id, label, onLabel, offLabel, current) => `
    <div class="field"><label>${label}</label><select class="select" id="${id}"><option value="">Leave as-is</option><option value="1">${onLabel}</option><option value="0">${offLabel}</option></select><span class="help">Currently: ${current}</span></div>`;
  openModal({
    title: `${esc(type.name)} · ${pretty}`, sub: `Nightly rate ${money(typeBaseRate(type))} for every ${esc(type.name)} room · same options as the Bulk updater, for this one day`,
    body: `
      <div class="form-3">
        <div class="field"><label>Rate (${moneyCurrency}/night)</label><input class="input mono" id="rdRate" type="number" min="0" step="0.01" value="${prev.rate != null ? prev.rate : typeBaseRate(type)}" placeholder="Leave blank = unchanged"></div>
        <div class="field"><label>Min stay (nights)</label><input class="input" id="rdMinStay" type="number" min="0" value="${prev.minStay ? prev.minStay : ""}" placeholder="Leave blank = unchanged"></div>
        <div class="field"><label>Max stay (nights)</label><input class="input" id="rdMaxStay" type="number" min="0" value="${prev.maxStay ? prev.maxStay : ""}" placeholder="Blank = unchanged · 0 clears"></div>
      </div>
      <div class="form-3">
        ${triState("rdClosed", "Closed (stop sell)", "Close this night", "Reopen this night", prev.closed ? "closed" : "open")}
        ${triState("rdCta", "CTA (closed to arrival)", "No arrivals", "Allow arrivals", prev.cta ? "no arrivals" : "arrivals allowed")}
        ${triState("rdCtd", "CTD (closed to departure)", "No departures", "Allow departures", prev.ctd ? "no departures" : "departures allowed")}
      </div>
      <p class="help" style="font-size:12px;color:var(--faint);margin-top:10px">${has ? "This date has its own rules. Fields left blank or set to Leave as-is keep their current values; Use defaults removes the override entirely." : "Saving creates rules for this date only. For many days at once, use the Bulk updater."}</p>`,
    foot: `${has ? `<button class="btn btn-ghost btn-sm" data-action="rd-clear" data-date="${iso}" type="button">Use defaults</button>` : ""}
      <button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="rd-save" data-date="${iso}" type="button">Save day rules</button>`,
    wide: true
  });
}
/* Bulk updater — many days, rooms and rate plans in one pass (like the
   classic channel-manager tool): date range x weekdays x targets x changes. */
function openBulkUpdater() {
  const todayIso = isoLocal(TODAY);
  const planTargets = [];
  roomTypes.map(normalizeRoomType).forEach((t) => (t.ratePlans || []).forEach((p) => planTargets.push({ type: t, plan: p })));
  const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  openModal({
    title: "Bulk updater", sub: "Update multiple fields at once across rooms and rate plans",
    body: `
      <div class="bulk-grid">
        <div class="bulk-col">
          <h4>When?</h4>
          <div class="field"><label>From</label><input class="input" id="buFrom" type="date" value="${todayIso}"></div>
          <div class="field"><label>To</label><input class="input" id="buTo" type="date" value="${todayIso}"></div>
          <h4 style="margin-top:14px">Which days?</h4>
          <div id="buDays">${dow.map((d, i) => `<label class="check-item"><input type="checkbox" class="bu-dow" value="${i}" checked><span>${d}</span></label>`).join("")}</div>
          <div style="display:flex;gap:6px;margin-top:10px">
            <button class="btn btn-ghost btn-xs" data-action="bu-days-all" type="button">Select all</button>
            <button class="btn btn-ghost btn-xs" data-action="bu-days-none" type="button">Unselect all</button>
          </div>
        </div>
        <div class="bulk-col">
          <h4>Which room types &amp; rates?</h4>
          <div id="buTargets">
            ${roomTypes.map((t) => `<label class="check-item"><input type="checkbox" class="bu-type" value="${esc(t.id)}" checked><span>${esc(t.name)} <span style="color:var(--faint)">(nightly ${money(typeBaseRate(t))})</span></span></label>`).join("") || `<p class="hint">Create a room type first.</p>`}
            ${planTargets.map(({ type, plan }) => `<label class="check-item"><input type="checkbox" class="bu-plan" value="${esc(type.id)}|${esc(plan.id)}"><span>${esc(type.name)} · ${esc(plan.name)} <span style="color:var(--faint)">(rate plan — min/max stay only)</span></span></label>`).join("")}
          </div>
          <div style="display:flex;gap:6px;margin-top:10px">
            <button class="btn btn-ghost btn-xs" data-action="bu-targets-all" type="button">Select all</button>
            <button class="btn btn-ghost btn-xs" data-action="bu-targets-none" type="button">Unselect all</button>
          </div>
          <p class="help" style="font-size:12px;color:var(--faint);margin-top:10px">Rate plans keep their % or $ difference, so the Rate field does not apply to them — bulk-edit their minimum and maximum stay instead.</p>
        </div>
        <div class="bulk-col">
          <h4>What changes?</h4>
          <div class="field"><label>Rate (${moneyCurrency}/night)</label><input class="input mono" id="buRate" type="number" min="0" step="0.01" placeholder="Leave blank = unchanged"></div>
          <div class="field"><label>Min stay (nights)</label><input class="input" id="buMinStay" type="number" min="0" placeholder="Leave blank = unchanged"></div>
          <div class="field"><label>Max stay (nights)</label><input class="input" id="buMaxStay" type="number" min="0" placeholder="Blank = unchanged · 0 clears"></div>
          <div class="field"><label>Closed (stop sell)</label><select class="select" id="buClosed"><option value="">Leave as-is</option><option value="1">Close these nights</option><option value="0">Reopen these nights</option></select></div>
          <div class="field"><label>CTA (closed to arrival)</label><select class="select" id="buCta"><option value="">Leave as-is</option><option value="1">No arrivals</option><option value="0">Allow arrivals</option></select></div>
          <div class="field"><label>CTD (closed to departure)</label><select class="select" id="buCtd"><option value="">Leave as-is</option><option value="1">No departures</option><option value="0">Allow departures</option></select></div>
        </div>
      </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="bu-apply" type="button">Update</button>`,
    wide: true
  });
}
function openRoomPhotos(code) {
  const r = roomByCode(code);
  if (!r) return;
  r.photos = r.photos || [];
  openModal({
    title: `Photos · ${r.code} ${r.name}`, sub: "First photo is the cover on your booking page",
    body: `
      <div class="photo-grid">${r.photos.map((p, i) => `<figure><img src="${esc(p)}" alt=""><button type="button" data-action="photo-del" data-code="${esc(r.code)}" data-i="${i}" aria-label="Remove photo">✕</button></figure>`).join("") || `<p class="hint">No photos yet. Upload the first below.</p>`}</div>
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
          url = await SHDB.uploadPublic("room-photos", `${SHDB.tenantId()}/${String(r.code).replace(/[^a-zA-Z0-9_-]/g, "-")}/${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`, f);
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
/* KPI cards are computed from this account's folios/transactions only —
   a new account has none, so it must read $0.00 / 0, never sample figures. */
function renderPaymentStats() {
  const collectedEl = $("#payCollected");
  if (!collectedEl) return;
  const paid = txns.filter((t) => t.status === "paid");
  collectedEl.textContent = money(paid.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const collectedSub = $("#payCollectedSub");
  if (collectedSub) collectedSub.textContent = `${paid.length} charge${paid.length === 1 ? "" : "s"}`;
  const open = reservations.filter((r) => balance(r) > 0 && r.status !== "cancelled");
  const outstandingEl = $("#payOutstanding");
  if (outstandingEl) outstandingEl.textContent = money(open.reduce((s, r) => s + balance(r), 0));
  const outstandingSub = $("#payOutstandingSub");
  if (outstandingSub) outstandingSub.textContent = `Across ${open.length} open folio${open.length === 1 ? "" : "s"}`;
}
function renderFolios() {
  renderPaymentStats();
  const open = reservations.filter((r) => balance(r) > 0 && r.status !== "cancelled");
  $("#folioTable tbody").innerHTML = open.map((r) => `
    <tr><td class="guest"><strong>${esc(r.guest)}</strong><span>${esc(r.contact)}</span></td>
      <td class="mono">${esc(r.ref)}</td><td><span class="room-code">${esc(r.room)}</span></td>
      <td><span class="tag">Room</span><span class="tag">Taxes</span>${r.ref === "R-1044" ? `<span class="tag">Firewood</span>` : ""}</td>
      <td class="num">${money(r.paid)}</td><td class="num" style="color:var(--danger)">${money(balance(r))}</td>
      <td style="text-align:right"><button class="btn btn-ghost btn-xs" data-action="charge" data-ref="${esc(r.ref)}" type="button">Charge ${money(balance(r))}</button></td></tr>`).join("") ||
    `<tr><td colspan="7"><div class="empty">All folios settled.</div></td></tr>`;
}
function renderTxns() {
  renderPaymentStats();
  $("#txnTable tbody").innerHTML = txns.map((t) => `
    <tr style="cursor:default"><td style="white-space:nowrap">${esc(t.when)}</td><td>${esc(t.desc)}</td>
      <td>${esc(t.method)}</td><td>${t.status === "paid" ? pill(["paid", "Paid"]) : pill(["neutral", "Refunded"])}</td>
      <td class="num">${money(t.amount)}</td></tr>`).join("") ||
    `<tr><td colspan="5"><div class="empty">No transactions yet.</div></td></tr>`;
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
/* ---------------- Booking page design (fonts, colors, corners, wording) ----------------
   The studio edits one theme object (js/booking-theme.js normalizes it) and
   previews the real booking page in an iframe: unsaved edits are posted to
   it on this origin only; Publish changes saves tenants.booking_theme. */
let studioTheme = SHTheme.normalize({});
let studioDevice = "desktop", studioPreviewTimer = null, studioUnitDraft = "";
const studioRoomNames = () => roomTypes.map((t) => t.name).concat(rooms.map((r) => r.name)).join(" ");
const STUDIO_UNITS = [["", "Automatic (from your room names)"]]
  .concat(SHTheme.UNITS.map(([k, one]) => [k, one.replace(/^./, (c) => c.toUpperCase())]))
  .concat([["custom", "Something else…"]]);
function setStudioTheme(patch) {
  studioTheme = SHTheme.normalize({ ...studioTheme, ...patch, colors: { ...studioTheme.colors, ...((patch && patch.colors) || {}) } });
  renderStudioDesign();
  queuePreview();
}
function renderStudioDesign() {
  const t = studioTheme;
  const presets = $("#bkPresets");
  if (presets) presets.innerHTML = Object.entries(SHTheme.PRESETS).map(([k, p]) => `
    <button type="button" class="theme-card${t.preset === k ? " sel" : ""}" data-preset="${k}" aria-pressed="${t.preset === k}">
      <span class="theme-swatch" style="background:${p.colors.bg}"><i style="background:${p.colors.brand}"></i><i style="background:${p.colors.accent}"></i><i style="background:${p.colors.ink}"></i></span>
      <span class="theme-name">${esc(p.label)}</span><span class="theme-font" style="font-family:${esc(SHTheme.FONTS[p.headingFont].stack)}">${esc(SHTheme.FONTS[p.headingFont].label)}</span></button>`).join("");
  renderFontPicker("heading", t.headingFont);
  renderFontPicker("body", t.bodyFont);
  const grid = $("#bkColorGrid");
  if (grid && !grid.children.length) {
    grid.innerHTML = SHTheme.COLOR_KEYS.map(([k, label]) => `
      <label class="color-cell"><input type="color" class="color-pick" data-color="${k}" aria-label="${esc(label)}"><span>${esc(label)}<b class="mono" data-color-val="${k}"></b></span></label>`).join("");
  }
  SHTheme.COLOR_KEYS.forEach(([k]) => {
    const inp = $(`#bkColorGrid [data-color="${k}"]`); if (inp && inp.value !== t.colors[k]) inp.value = t.colors[k];
    const val = $(`#bkColorGrid [data-color-val="${k}"]`); if (val) val.textContent = t.colors[k];
  });
  $$("#bkRadius [data-r]").forEach((b) => b.classList.toggle("active", b.dataset.r === t.radius));
  const unit = $("#bkUnit");
  if (unit) unit.innerHTML = STUDIO_UNITS.map(([v, l]) => `<option value="${v}"${v === t.unitNoun ? " selected" : ""}>${esc(l)}</option>`).join("");
  const custom = $("#bkUnitCustom");
  if (custom) {
    custom.hidden = t.unitNoun !== "custom" && studioUnitDraft !== "custom";
    if (document.activeElement !== $("#bkUnitOne")) $("#bkUnitOne").value = t.unitOne || "";
    if (document.activeElement !== $("#bkUnitMany")) $("#bkUnitMany").value = t.unitMany || "";
  }
  const words = SHTheme.unitWords(t, studioRoomNames());
  const helpEl = $("#bkUnitHelp");
  if (helpEl) helpEl.textContent = `Your page will say “Choose your ${words.one}” and “${words.many.replace(/^./, (c) => c.toUpperCase())}” in the menu.`;
  const eb = $("#bkEyebrow"); if (eb && document.activeElement !== eb) eb.value = t.eyebrow;
  const num = $("#bkNumbered"); if (num) num.checked = t.numberedSteps;
  // Readability: WCAG 4.5:1 for text, 3:1 for large headings and buttons.
  // Buttons sit on cards (search bar, rooms, summary); links sit on the page.
  const cc = t.colors, ratio = SHTheme.contrast, warn = [];
  if (ratio(cc.ink, cc.bg) < 4.5) warn.push("Page text is hard to read on the page background.");
  if (ratio(cc.heading, cc.bg) < 3) warn.push("Headings are hard to read on the page background.");
  if (ratio(cc.surfaceInk, cc.surface) < 4.5) warn.push("Card text is hard to read on the card color.");
  if (ratio(cc.brand, cc.surface) < 3) warn.push("Buttons blend into the cards.");
  const c = $("#bkContrast");
  if (c) { c.textContent = warn.length ? "⚠ " + warn.join(" ") : "Text and buttons pass readability contrast checks."; c.classList.toggle("warn", warn.length > 0); }
}
/* Font pickers: a listbox that shows every font in its own face (native
   <select> menus can't show fonts on every platform). The preview faces are
   subset to the letters of the names, so they load in one small request. */
let fontPreviewsLoaded = false;
function loadFontPreviews() {
  if (fontPreviewsLoaded) return;
  fontPreviewsLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = SHTheme.previewFontsHref();
  document.head.appendChild(link);
}
function renderFontPicker(kind, current) {
  const wrap = $(`.font-pick[data-kind="${kind}"]`); if (!wrap) return;
  const weight = (k) => (kind === "heading" ? SHTheme.HEAD_WEIGHT[k] || 600 : 400);
  const f = SHTheme.FONTS[current];
  const btn = $(".font-pick-btn", wrap);
  btn.innerHTML = `<span>${esc(f.label)}</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  btn.firstElementChild.style.fontFamily = f.stack;
  btn.firstElementChild.style.fontWeight = weight(current);
  $(".font-pick-list", wrap).innerHTML = Object.entries(SHTheme.FONTS).filter(([, x]) => x[kind]).map(([k, x]) =>
    `<li role="option" id="fp-${kind}-${k}" data-font="${k}" aria-selected="${k === current}" style="font-family:${esc(x.stack)};font-weight:${weight(k)}">${esc(x.label)}</li>`).join("");
}
function showFontOption(list, li) {
  if (!li) return;
  $$('[role="option"]', list).forEach((o) => o.classList.toggle("active", o === li));
  list.setAttribute("aria-activedescendant", li.id);
  li.scrollIntoView({ block: "nearest" });
}
function openFontPicker(wrap) {
  closeFontPickers();
  loadFontPreviews();
  const list = $(".font-pick-list", wrap);
  list.hidden = false;
  $(".font-pick-btn", wrap).setAttribute("aria-expanded", "true");
  list.focus({ preventScroll: true });
  showFontOption(list, $('[aria-selected="true"]', list) || list.firstElementChild);
}
function closeFontPickers(refocus) {
  $$(".font-pick").forEach((wrap) => {
    const list = $(".font-pick-list", wrap);
    if (list.hidden) return;
    list.hidden = true;
    $(".font-pick-btn", wrap).setAttribute("aria-expanded", "false");
    if (refocus === wrap) $(".font-pick-btn", wrap).focus();
  });
}
function chooseFont(wrap, key) {
  closeFontPickers(wrap);
  setStudioTheme(wrap.dataset.kind === "heading" ? { headingFont: key } : { bodyFont: key });
}
function bindFontPickers() {
  $$(".font-pick").forEach((wrap) => {
    const btn = $(".font-pick-btn", wrap), list = $(".font-pick-list", wrap);
    btn.addEventListener("click", () => (list.hidden ? openFontPicker(wrap) : closeFontPickers(wrap)));
    btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openFontPicker(wrap); } });
    list.addEventListener("click", (e) => { const li = e.target.closest('[role="option"]'); if (li) chooseFont(wrap, li.dataset.font); });
    list.addEventListener("keydown", (e) => {
      const opts = $$('[role="option"]', list), i = opts.indexOf($(".active", list));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); showFontOption(list, opts[Math.min(opts.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); showFontOption(list, opts[e.key === "Home" ? 0 : opts.length - 1]); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (opts[i]) chooseFont(wrap, opts[i].dataset.font); }
      else if (e.key === "Escape") { e.preventDefault(); closeFontPickers(wrap); }
      else if (e.key === "Tab") closeFontPickers();
    });
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".font-pick")) closeFontPickers(); });
}
function studioSlug() {
  const v = ($("#bkUrl") ? $("#bkUrl").value : "").trim().split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "");
  return (liveTenant && liveTenant.slug) || v || "pinecrest";
}
function setPreviewSrc() {
  const f = $("#bkPreview");
  if (!f || !location.protocol.startsWith("http")) return;
  const src = location.origin + "/book.html?property=" + encodeURIComponent(studioSlug()) + "&preview=1";
  if (f.dataset.src !== src) { f.dataset.src = src; f.src = src; }
  sizePreview();
}
function sizePreview() {
  const box = $("#bkPreviewBox"), f = $("#bkPreview");
  if (!box || !f) return;
  const w = studioDevice === "mobile" ? 390 : 1280, h = studioDevice === "mobile" ? 760 : 1180;
  const scale = Math.min(1, box.clientWidth / w);
  f.style.width = w + "px"; f.style.height = h + "px";
  f.style.transform = `scale(${scale})`;
  f.style.left = studioDevice === "mobile" ? Math.max(0, (box.clientWidth - w * scale) / 2) + "px" : "0";
  box.style.height = Math.round(h * scale) + "px";
}
function sendPreview() {
  const f = $("#bkPreview");
  if (!f || !f.contentWindow || !location.protocol.startsWith("http")) return;
  f.contentWindow.postMessage({
    type: "simplehotelier:preview", theme: studioTheme,
    content: { name: $("#bkName") ? $("#bkName").value : undefined, headline: $("#bkHead") ? $("#bkHead").value : undefined, sub: $("#bkSub") ? $("#bkSub").value : undefined, heroUrl: studioHeroUrl || null, heroFocus: studioHeroFocus }
  }, location.origin);
}
function queuePreview() { clearTimeout(studioPreviewTimer); studioPreviewTimer = setTimeout(sendPreview, 120); }
window.addEventListener("message", (e) => {
  const f = $("#bkPreview");
  if (e.origin === location.origin && f && e.source === f.contentWindow && e.data && e.data.type === "simplehotelier:preview-ready") sendPreview();
});
window.addEventListener("resize", sizePreview);
/* Reflect the studio's colors + hero in the live preview (right pane). */
function applyStudioPreview() {
  const focusEl = $("#bkHeroFocus"), focusDot = $("#bkHeroFocusDot"), focusVal = $("#bkHeroFocusVal");
  if (focusEl) {
    focusEl.hidden = !studioHeroUrl;
    if (studioHeroUrl) focusEl.style.backgroundImage = `url("${String(studioHeroUrl).replace(/"/g, "%22")}")`;
    focusEl.style.backgroundPosition = `${studioHeroFocus.x}% ${studioHeroFocus.y}%`;
  }
  if (focusDot) { focusDot.style.left = studioHeroFocus.x + "%"; focusDot.style.top = studioHeroFocus.y + "%"; }
  if (focusVal) {
    focusVal.hidden = !studioHeroUrl;
    focusVal.textContent = `Focus: ${Math.round(studioHeroFocus.x)}% across · ${Math.round(studioHeroFocus.y)}% down — the preview follows it; saved with Publish changes`;
  }
  const thumb = $("#bkHeroThumb"), empty = $("#bkHeroEmpty");
  if (thumb) { thumb.src = studioHeroUrl || ""; thumb.hidden = !studioHeroUrl; }
  if (empty) empty.style.display = studioHeroUrl ? "none" : "grid";
  queuePreview();
}
function bindStudio() {
  ["bkName", "bkHead", "bkSub"].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener("input", queuePreview); });
  $("#bkUrl").addEventListener("input", (e) => { $("#bkUrlPrev").textContent = e.target.value || "you.simplehotelier.com"; });
  renderStudioDesign();
  $("#bkPresets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]"); if (!b) return;
    const p = SHTheme.PRESETS[b.dataset.preset];
    // A preset swaps fonts, colors and corners; the property's wording stays.
    setStudioTheme({ ...p, colors: { ...p.colors }, preset: b.dataset.preset });
  });
  bindFontPickers();
  $("#bkColorGrid").addEventListener("input", (e) => { const k = e.target.dataset.color; if (k) setStudioTheme({ colors: { [k]: e.target.value } }); });
  $("#bkRadius").addEventListener("click", (e) => { const b = e.target.closest("[data-r]"); if (b) setStudioTheme({ radius: b.dataset.r }); });
  $("#bkUnit").addEventListener("change", (e) => {
    studioUnitDraft = e.target.value;
    if (e.target.value === "custom") { renderStudioDesign(); $("#bkUnitOne").focus(); return; } // saved once a word is typed
    setStudioTheme({ unitNoun: e.target.value, unitOne: "", unitMany: "" });
  });
  ["bkUnitOne", "bkUnitMany"].forEach((id) => $("#" + id).addEventListener("input", () =>
    setStudioTheme({ unitNoun: "custom", unitOne: $("#bkUnitOne").value, unitMany: $("#bkUnitMany").value })));
  $("#bkEyebrow").addEventListener("input", (e) => setStudioTheme({ eyebrow: e.target.value }));
  $("#bkNumbered").addEventListener("change", (e) => setStudioTheme({ numberedSteps: e.target.checked }));
  $("#bkDevice").addEventListener("click", (e) => {
    const b = e.target.closest("[data-device]"); if (!b) return;
    studioDevice = b.dataset.device;
    $$("#bkDevice [data-device]").forEach((x) => x.classList.toggle("active", x === b));
    sizePreview();
  });
  if (window.ResizeObserver && $("#bkPreviewBox")) new ResizeObserver(sizePreview).observe($("#bkPreviewBox"));
  setPreviewSrc();
  const heroFile = $("#bkHeroFile");
  if (heroFile) heroFile.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast("Hero image too large", "Please use an image under 5 MB", "warn"); return; }
    try {
      let url;
      if (window.SHDB && SHDB.hasLive()) {
        url = await SHDB.uploadPublic("property-logos", `${SHDB.tenantId()}/hero-${Date.now()}.${(f.name.split(".").pop() || "png").toLowerCase()}`, f);
        await SHDB.updateTenantSettings({ hero_image_url: url });
        toast("Hero image saved", "It now tops your booking page", "ok");
      } else {
        url = URL.createObjectURL(f);
        toast("Hero preview only", "Sign in live to save it to your property", "warn");
      }
      studioHeroUrl = url;
      applyStudioPreview();
    } catch { toast("Hero upload failed", "Check the image and try again", "err"); }
  });
  const heroRemove = $("#bkHeroRemove");
  if (heroRemove) heroRemove.addEventListener("click", async () => {
    if (!studioHeroUrl) return;
    if (window.SHDB && SHDB.hasLive()) {
      try { await SHDB.updateTenantSettings({ hero_image_url: null }); } catch { toast("Could not remove hero", "Supabase write failed", "warn"); return; }
    }
    studioHeroUrl = "";
    if (heroFile) heroFile.value = "";
    applyStudioPreview();
    toast("Hero image removed", "Your headline sits on the brand color again", "ok");
  });
  const focusEl = $("#bkHeroFocus");
  if (focusEl) {
    let dragging = false;
    const setFromEvent = (e) => {
      const r = focusEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      studioHeroFocus.x = Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100));
      studioHeroFocus.y = Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100));
      applyStudioPreview();
    };
    focusEl.addEventListener("pointerdown", (e) => { dragging = true; try { focusEl.setPointerCapture(e.pointerId); } catch { /* no capture */ } setFromEvent(e); });
    focusEl.addEventListener("pointermove", (e) => { if (dragging) setFromEvent(e); });
    focusEl.addEventListener("pointerup", () => { dragging = false; });
    focusEl.addEventListener("pointercancel", () => { dragging = false; });
  }
}

/* ---------------- Reports (computed from your reservations, not samples) ---------------- */
let reportDays = 30;
function computeReports(days) {
  const active = reservations.filter((r) => r.status !== "cancelled");
  const inWin = active.filter((r) => r.inN >= -(days - 1) && r.inN <= 0);
  // Chart buckets: daily up to 31 days, weekly beyond that.
  const buckets = [];
  if (days <= 31) {
    for (let off = -(days - 1); off <= 0; off++) {
      const dt = addDays(off);
      buckets.push({ label: String(dt.getDate()), title: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: 0 });
    }
    inWin.forEach((r) => { const b = buckets[r.inN + days - 1]; if (b) b.value += r.total; });
  } else {
    const weeks = Math.ceil(days / 7);
    for (let w = weeks - 1; w >= 0; w--) buckets.push({ label: "W" + (weeks - w), title: "Week of " + dstr(addDays(-w * 7 - 6)), value: 0 });
    inWin.forEach((r) => { const w = Math.min(weeks - 1, Math.floor(-r.inN / 7)); buckets[weeks - 1 - w].value += r.total; });
  }
  const byRoom = {};
  inWin.forEach((r) => { byRoom[r.room] = (byRoom[r.room] || 0) + r.total; });
  const top = Object.entries(byRoom).map(([code, v]) => { const rm = roomByCode(code); return [code + (rm ? " · " + rm.name : ""), Math.round(v * 100) / 100]; }).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const taxRows = taxes.filter((t) => t.on).map((t) => {
    let amt = 0;
    inWin.forEach((r) => { const nights = Math.max(1, r.outN - r.inN); amt += t.kind === "percent" ? r.total * t.value / 100 : t.value * nights; });
    return [t.name, Math.round(amt * 100) / 100];
  });
  const byStatus = { "checked-in": 0, confirmed: 0, pending: 0, "checked-out": 0 };
  inWin.forEach((r) => { if (byStatus[r.status] != null) byStatus[r.status]++; });
  return {
    days, buckets, top, taxRows,
    taxTotal: Math.round(taxRows.reduce((s, [, v]) => s + v, 0) * 100) / 100,
    revenue: Math.round(inWin.reduce((s, r) => s + r.total, 0) * 100) / 100,
    collected: Math.round(inWin.reduce((s, r) => s + r.paid, 0) * 100) / 100,
    count: inWin.length, byStatus
  };
}
function renderReports() {
  const rep = computeReports(reportDays);
  const max = Math.max(1, ...rep.buckets.map((d) => d.value));
  $("#revChart").innerHTML = rep.buckets.map((d) =>
    `<div class="bar" title="${esc(d.title)} · ${money(d.value)}"><i style="height:${Math.max(2, Math.round(d.value / max * 100))}%"></i><span>${esc(d.label)}</span></div>`).join("") ||
    `<div class="empty">No bookings in this window yet.</div>`;
  const tmax = rep.top.length ? rep.top[0][1] : 1;
  $("#topRooms").innerHTML = rep.top.map(([n, v]) => `
    <div class="row-item"><div class="ri-main" style="flex:1"><strong>${esc(n)}</strong>
      <div class="progress" style="background:var(--surface-3);margin-top:6px"><i style="width:${Math.round(v / tmax * 100)}%;background:var(--brand-2)"></i></div></div>
      <div class="ri-right mono">${money(v)}</div></div>`).join("") || `<div class="empty">No revenue in this window yet.</div>`;
  $("#taxLiability").innerHTML = (rep.taxRows.map(([n, v]) => `<dt>${esc(n)}</dt><dd class="mono">${money(v)}</dd>`).join("") ||
    `<dt>No tax rules yet</dt><dd class="mono">—</dd>`) +
    `<dt><strong>Estimated total</strong></dt><dd class="mono"><strong>${money(rep.taxTotal)}</strong></dd>`;
  const sub = $("#repSub"); if (sub) sub.textContent = `Revenue, occupancy and booking mix · last ${reportDays} days · ${rep.count} reservations · ${money(rep.revenue)} booked`;
  const card = $("#channelCard");
  if (card) {
    const groups = [["In-house", rep.byStatus["checked-in"], "#0c3b3c"], ["Confirmed", rep.byStatus.confirmed, "#c98a2e"], ["Pending", rep.byStatus.pending, "#7fa8a3"], ["Checked out", rep.byStatus["checked-out"], "#b9c8c3"]];
    const total = Math.max(1, groups.reduce((s, g) => s + g[1], 0));
    const C = 2 * Math.PI * 58;
    let acc = 0;
    const arcs = groups.filter((g) => g[1] > 0).map((g) => {
      const frac = g[1] / total;
      const s = `<circle cx="75" cy="75" r="58" fill="none" stroke="${g[2]}" stroke-width="20" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-acc * C).toFixed(1)}" transform="rotate(-90 75 75)"/>`;
      acc += frac; return s;
    }).join("");
    card.innerHTML = `<h3>Bookings by status</h3><p class="hint">${rep.count} reservations in the last ${reportDays} days</p>
      <div class="donut-row">
        <svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="58" fill="none" stroke="#e8eeec" stroke-width="20"/>${arcs}<text x="75" y="71" text-anchor="middle" font-family="Sora,sans-serif" font-weight="700" font-size="22" fill="#101f1e">${rep.count}</text><text x="75" y="89" text-anchor="middle" font-size="11" fill="#5d6f6b">reservations</text></svg>
        <div class="legend" style="flex:1">${groups.map((g) => `<div><i style="background:${g[2]}"></i>${g[0]}<b>${total ? Math.round(g[1] / total * 100) : 0}%</b></div>`).join("")}</div>
      </div>`;
  }
}

/* ---------------- Modals: reservation detail / new / charge ---------------- */
/* Reservation detail, new reservations and charges all use the editor in js/reservation.js. */
function openResDetail(ref) { openReservationEditor(ref); }

function openNewTicket() {
  openModal({
    title: "New maintenance ticket", sub: "Report an issue for your team to fix",
    body: `
      <div class="field"><label>Issue</label><input class="input" id="tkTitle" placeholder="e.g. Leaky kitchen faucet"></div>
      <div class="form-2">
        <div class="field"><label>Room (optional)</label><select class="select" id="tkRoom"><option value="">Property-wide</option>${rooms.map((r) => `<option value="${r.id || ""}" data-code="${esc(r.code)}">${esc(r.code)} · ${esc(r.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Priority</label><select class="select" id="tkPrio"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High — guest-impacting</option></select></div>
      </div>
      <div class="field"><label>Details</label><textarea class="textarea" id="tkDesc" placeholder="What's wrong, where, and anything the fixer should bring…"></textarea></div>
      <div class="field"><label>Photo (optional)</label><input class="input" id="tkPhoto" type="file" accept="image/*"></div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button>
      <button class="btn btn-primary btn-sm" data-action="save-ticket" type="button">Create ticket</button>`,
    wide: true
  });
  const inp = $("#tkTitle"); if (inp) inp.focus();
}

/* ---------------- Global action dispatch ---------------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  // notification bell (no data-action)
  if (e.target.closest("#notifBtn")) {
    const items = [];
    reservations.filter((r) => r.status === "pending").slice(0, 3).forEach((r) => {
      items.push(`<div class="row-item"><span class="pill pending"><i></i>New</span><div class="ri-main"><strong>Booking request: ${esc(r.guest)}</strong><span>${esc(r.room)} · ${esc(resDates(r))} · ${money(r.total)}</span></div><div class="ri-right"><button class="btn btn-ghost btn-xs" data-action="res-detail" data-ref="${esc(r.ref)}" type="button">Review</button></div></div>`);
    });
    reservations.filter((r) => balance(r) > 0 && r.status !== "cancelled").slice(0, 3).forEach((r) => {
      items.push(`<div class="row-item"><span class="pill overdue"><i></i>Unpaid</span><div class="ri-main"><strong>${esc(r.ref)} balance ${money(balance(r))}</strong><span>${esc(r.guest)} · ${esc(r.room)}</span></div><div class="ri-right"><button class="btn btn-ghost btn-xs" data-action="charge" data-ref="${esc(r.ref)}" type="button">Charge</button></div></div>`);
    });
    openModal({
      title: "Notifications", sub: "Needs your attention",
      body: `<div class="row-list">${items.join("") || `<div class="empty">All caught up. No pending requests or unpaid balances.</div>`}</div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Close</button>`,
    });
    return;
  }
  if (!el) return;
  const a = el.dataset.action, ref = el.dataset.ref;

  if (a === "confirm-yes") { const cb = confirmCb; confirmCb = null; closeModal(); if (cb) cb(); return; }
  if (a === "new-reservation") openReservationEditor(null);
  else if (a === "new-ticket") openNewTicket();
  else if (a === "save-ticket") {
    const title = $("#tkTitle").value.trim();
    if (!title) { toast("Give the issue a title", "e.g. Leaky kitchen faucet", "warn"); return; }
    const roomSel = $("#tkRoom");
    const roomCode = roomSel.selectedOptions[0] ? roomSel.selectedOptions[0].dataset.code || "" : "";
    const ticket = { roomCode, roomId: roomSel.value || null, title, desc: $("#tkDesc").value.trim(), priority: $("#tkPrio").value, photo: "" };
    const file = $("#tkPhoto").files && $("#tkPhoto").files[0];
    const finish = (saved) => {
      tickets.unshift(saved || { id: "local-" + Date.now(), ...ticket, status: "open", when: "Just now" });
      closeModal(); renderMaintenance(); toast("Ticket created", title, "ok");
    };
    if (window.SHDB && SHDB.hasLive()) {
      (async () => {
        try {
          if (file) ticket.photo = await SHDB.uploadPublic("room-photos", `${SHDB.tenantId()}/maintenance/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`, file);
          const row = await SHDB.createTicket(ticket);
          finish(row ? { id: row.id, roomCode: ticket.roomCode, title: row.title, desc: row.description || "", photo: row.photo_url || "", priority: row.priority, status: row.status, when: "Just now" } : null);
        } catch { toast("Ticket saved locally only", "Supabase write failed", "warn"); finish(null); }
      })();
    } else finish(null);
  }
  else if (a === "ticket-status") {
    const t = tickets.find((x) => x.id === el.dataset.id);
    if (t) {
      t.status = el.dataset.status;
      if (window.SHDB && SHDB.hasLive() && !String(t.id).startsWith("local-")) SHDB.setTicketStatus(t.id, t.status).catch(() => toast("Status saved locally only", "Supabase write failed", "warn"));
      renderMaintenance(); toast("Ticket updated", `${t.title} → ${t.status.replace("_", " ")}`, "ok");
    }
  }
  else if (a === "del-ticket") {
    const t = tickets.find((x) => x.id === el.dataset.id);
    if (t) confirmAction("Delete this ticket?", `<strong>${esc(t.title)}</strong> will be removed from the maintenance board.`, "Delete ticket", () => {
      tickets = tickets.filter((x) => x.id !== t.id);
      if (window.SHDB && SHDB.hasLive() && !String(t.id).startsWith("local-")) SHDB.deleteTicket(t.id).catch(() => {});
      renderMaintenance(); toast("Ticket deleted", t.title, "ok");
    });
  }
  else if (a === "copy-ical") {
    const inp = $("#icalExportUrl");
    if (inp && inp.value.startsWith("http")) { inp.select(); navigator.clipboard && navigator.clipboard.writeText(inp.value); toast("Calendar link copied", "Paste it into Airbnb or Vrbo to block your booked dates", "ok"); }
    else toast("No link yet", "Sign in with your property account first", "warn");
  }
  else if (a === "regen-ical") {
    if (!(window.SHDB && SHDB.hasLive())) { toast("Sign in live first", "Calendar links need your property account", "warn"); return; }
    confirmAction("Regenerate calendar link?", "The old link stops working everywhere you pasted it (Airbnb, Vrbo). You will need to paste the new link in again.", "Regenerate", async () => {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("");
      try { await SHDB.updateTenantSettings({ ical_token: token }); liveIcalToken = token; renderIcal(); toast("New calendar link ready", "Copy it into Airbnb / Vrbo", "ok"); }
      catch { toast("Could not regenerate", "Supabase write failed", "warn"); }
    });
  }
  else if (a === "add-feed") {
    if (!(window.SHDB && SHDB.hasLive())) { toast("Sign in live first", "Calendar import needs your property account", "warn"); return; }
    const roomSel = $("#icalRoom"), url = $("#icalUrl").value.trim();
    if (!roomSel.value) { toast("Pick a room", "Each external calendar belongs to one room", "warn"); return; }
    if (!/^https?:\/\/.+/i.test(url)) { toast("Paste the calendar URL", "Airbnb: Calendar → Availability → Export Calendar", "warn"); return; }
    const name = $("#icalName").value.trim() || ($("#icalSource").value === "vrbo" ? "Vrbo calendar" : "Airbnb calendar");
    const roomCode = roomSel.selectedOptions[0] ? roomSel.selectedOptions[0].dataset.code || "" : "";
    (async () => {
      try {
        const row = await SHDB.createIcalFeed({ roomId: roomSel.value, name, source: $("#icalSource").value, url });
        if (!row) throw new Error("no row");
        icalFeeds.push({ id: row.id, roomId: row.room_id, roomCode, name: row.name, source: row.source, url: row.url, lastSynced: null, lastError: "" });
        $("#icalUrl").value = ""; $("#icalName").value = "";
        renderIcal(); toast("Calendar added", "Syncing now…", "ok");
        fnInvoke("ical-sync", { feed_id: row.id }).then((r) => {
          const f = icalFeeds.find((x) => x.id === row.id); if (f) { f.lastSynced = new Date().toISOString(); f.lastError = r.error || ""; }
          renderIcal(); toast("Calendar synced", `${r.imported || 0} bookings blocked, ${r.skipped || 0} skipped`, r.error ? "warn" : "ok");
        }).catch((e) => toast("Sync failed", e.message, "warn"));
      } catch { toast("Could not add calendar", "Supabase write failed", "warn"); }
    })();
  }
  else if (a === "sync-feed") {
    const f = icalFeeds.find((x) => x.id === el.dataset.id);
    if (!f) return;
    toast("Syncing calendar", f.name + "…", "");
    fnInvoke("ical-sync", { feed_id: f.id }).then((r) => {
      f.lastSynced = new Date().toISOString(); f.lastError = r.error || "";
      renderIcal(); toast("Calendar synced", `${r.imported || 0} bookings blocked, ${r.skipped || 0} skipped`, r.error ? "warn" : "ok");
    }).catch((e) => toast("Sync failed", e.message, "warn"));
  }
  else if (a === "del-feed") {
    const f = icalFeeds.find((x) => x.id === el.dataset.id);
    if (f) confirmAction("Remove this calendar?", `<strong>${esc(f.name)}</strong> will stop syncing. Dates it already blocked stay blocked until you delete them from Reservations.`, "Remove calendar", () => {
      icalFeeds = icalFeeds.filter((x) => x.id !== f.id);
      if (window.SHDB && SHDB.hasLive()) SHDB.deleteIcalFeed(f.id).catch(() => {});
      renderIcal(); toast("Calendar removed", f.name, "ok");
    });
  }
  else if (a === "res-detail") openResDetail(ref);
  else if (a === "charge") { if (ref) openReservationEditor(ref, { panel: "charge" }); else openReservationPicker("charge"); }
  else if (a === "confirm-res") {
    const r = reservations.find((x) => x.ref === ref); r.status = "confirmed";
    if (window.SHDB && r.id) SHDB.setReservationStatus(r.id, "confirmed").catch(() => toast("Status saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderReservations(); renderToday(); toast(`${ref} confirmed`, r.guest, "ok");
  }
  else if (a === "record-cash") openReservationPicker("record");
  else if (a === "export") {
    const activeView = document.querySelector(".view.active")?.id || "";
    const csvCell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    let rows, fname;
    if (activeView === "view-reports") {
      const rep = computeReports(reportDays);
      rows = [["Metric", "Value"], ["Window (days)", rep.days], ["Reservations", rep.count], ["Revenue booked", rep.revenue.toFixed(2)], ["Collected", rep.collected.toFixed(2)], ["Estimated tax liability", rep.taxTotal.toFixed(2)], ["", ""], ["Top unit", "Revenue"]]
        .concat(rep.top.map(([n, v]) => [n, v.toFixed(2)]))
        .concat([["", ""], ["Tax rule", "Estimated amount"]], rep.taxRows.map(([n, v]) => [n, v.toFixed(2)]));
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
  else if (a === "room-rates") { const r = roomByCode(el.dataset.code); const t = r && typeOfRoom(r); if (t) { ratesTypeId = t.id; goto("rates"); } else toast("No room type yet", "Assign a type to this room first — rates live on types", "warn"); }
  else if (a === "rt-edit") openRoomTypes(roomTypes[+el.dataset.i].id);
  else if (a === "rt-del") {
    const gone = roomTypes[+el.dataset.i];
    if (!gone) return;
    confirmAction(`Delete “${gone.name}”?`, "Rooms with this type keep their own names and rates, but lose the shared details, features and rate plans. This cannot be undone.", "Delete type", () => {
      roomTypes.splice(roomTypes.indexOf(gone), 1);
      rooms.forEach((r) => { if (r.typeId === gone.id) r.typeId = null; });
      if (window.SHDB && gone.id && !String(gone.id).startsWith("demo-")) SHDB.deleteRoomType(gone.id).catch(() => toast("Deleted locally only", "Supabase delete failed", "warn"));
      toast(`Deleted type “${gone.name}”`, "Rooms keep their own names and rates", "warn");
      openRoomTypes();
    });
  }
  else if (a === "rt-rates") openRoomTypeRates(roomTypes[+el.dataset.i].id);
  else if (a === "rtp-back") openRoomTypes(el.dataset.type);
  else if (a === "rtp-edit") openRoomTypeRates(el.dataset.type, el.dataset.plan);
  else if (a === "rtp-del") {
    if (document.querySelector("#view-ratemgmt.active")) rtpCtx = "page";
    const t = roomTypes.find((x) => x.id === el.dataset.type);
    const pl = t && normalizeRoomType(t).ratePlans.find((x) => x.id === el.dataset.plan);
    if (!t || !pl) return;
    confirmAction(`Delete “${pl.name}”?`, "Bookings will use the standard rate instead. This cannot be undone.", "Delete rate plan", () => {
      t.ratePlans = normalizeRoomType(t).ratePlans.filter((x) => x.id !== pl.id);
      persistRoomType(t);
      toast(`Deleted rate plan “${pl.name}”`, t.name, "warn");
      planReturn();
    });
  }
  else if (a === "rtp-save") {
    const t = roomTypes.find((x) => x.id === el.dataset.type);
    if (!t) return;
    const data = readRatePlanForm();
    if (!data.name) { toast("Give the rate plan a name", "e.g. Extended stay rate", "warn"); return; }
    if (data.maxStay > 0 && data.minStay > data.maxStay) { toast("Check stay limits", "Minimum stay is longer than the maximum stay", "warn"); return; }
    t.ratePlans = normalizeRoomType(t).ratePlans;
    const planId = el.dataset.plan;
    if (planId) {
      const ix = t.ratePlans.findIndex((x) => x.id === planId);
      if (ix >= 0) t.ratePlans[ix] = { ...data, id: planId };
      toast("Rate plan saved", data.name, "ok");
    } else {
      t.ratePlans.push(data);
      toast("Rate plan added", `${data.name} · ${t.name}`, "ok");
    }
    persistRoomType(t);
    planReturn();
  }
  else if (a === "rmt-add") {
    if (!ratesTypeId && roomTypes.length) ratesTypeId = roomTypes[0].id;
    if (!ratesTypeId) { toast("Create a room type first", "Rates belong to room types", "warn"); return; }
    openRoomTypeRates(ratesTypeId, null, true);
  }
  else if (a === "rmt-edit") openRoomTypeRates(el.dataset.type, el.dataset.plan, true);
  else if (a === "rmt-default-edit") openRoomTypes(el.dataset.type);
  else if (a === "rt-photos") openRoomTypePhotos(roomTypes[+el.dataset.i].id);
  else if (a === "rt-photo-del") {
    const t = roomTypes.find((x) => x.id === el.dataset.id);
    if (t) {
      t.photos.splice(+el.dataset.i, 1);
      if (window.SHDB && SHDB.hasLive() && !String(t.id).startsWith("demo-") && !String(t.id).startsWith("local-")) SHDB.updateRoomType(t.id, normalizeRoomType(t)).catch(() => {});
      openRoomTypePhotos(t.id);
    }
  }
  else if (a === "rt-bed-add") {
    const wrap = $("#rtBeds");
    if (wrap) { wrap.insertAdjacentHTML("beforeend", bedRowHtml()); const qty = wrap.lastElementChild && $(".rt-bed-qty", wrap.lastElementChild); if (qty) qty.focus(); }
  }
  else if (a === "rt-bed-del") {
    const row = el.closest(".bed-row");
    if (row) row.remove();
  }
  else if (a === "rt-save") {
    const data = readRoomTypeForm();
    if (!data.name) { toast("Give the type a name", "e.g. Cabin, Suite, Loft", "warn"); return; }
    if (data.maxStay > 0 && data.minStay > data.maxStay) { toast("Check stay limits", "Minimum stay is longer than the maximum stay", "warn"); return; }
    const included = data.includedAdults + data.includedChildren + data.includedInfants;
    if (data.maxOccupants > 0 && included > data.maxOccupants) { toast("Check occupancy", "Included occupants exceed the maximum occupants", "warn"); return; }
    const editId = el.dataset.edit;
    if (editId) {
      const t = roomTypes.find((x) => x.id === editId);
      const oldName = t.name;
      Object.assign(t, data, { photos: Array.isArray(t.photos) ? t.photos : [] });
      rooms.forEach((r) => { if (r.typeId === t.id || r.typeName === oldName) { r.typeName = data.name; syncRoomType(r); } });
      if (window.SHDB && SHDB.hasLive() && !String(t.id).startsWith("demo-")) SHDB.updateRoomType(t.id, normalizeRoomType(t)).catch(() => toast("Type saved locally only", "Supabase write failed", "warn"));
      else if (window.SHDB && SHDB.hasLive()) SHDB.createRoomType(normalizeRoomType(t)).then((row) => { if (row) t.id = row.id; }).catch(() => {});
      toast("Room type saved", data.name, "ok");
    } else {
      const nt = normalizeRoomType({ ...data, id: "local-" + Date.now(), photos: [] });
      roomTypes.push(nt);
      if (window.SHDB && SHDB.hasLive()) SHDB.createRoomType(nt).then((row) => { if (row) nt.id = row.id; }).catch(() => toast("Type saved locally only", "Supabase write failed", "warn"));
      toast("Room type added", `${data.name} · its Default Rate (${money(data.rackRate || 0)}/night) is live`, "ok");
    }
    renderRooms();
    closeModal();
  }
  else if (a === "save-edit-room") {
    const r = roomByCode(el.dataset.code);
    r.name = $("#erName").value.trim() || r.name;
    r.note = $("#erNotes").value.trim();
    const t = roomTypes.find((x) => x.id === $("#erType").value);
    r.typeId = t ? t.id : null;
    r.typeName = t ? t.name : "";
    if (t) r.sleeps = typeSleeps(t);
    syncRoomType(r);
    if (window.SHDB && r.id) SHDB.updateRoom(r.id, { name: r.name, sleeps: r.sleeps, typeId: r.typeId, notes: r.note }).catch(() => toast("Room saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderRooms(); renderRates();
    toast(`${r.code} saved`, `${r.name} · ${money(roomRate(r))}/night from its type`, "ok");
  }
  else if (a === "rd-save") {
    const type = ratesType();
    if (!type) return;
    const iso = el.dataset.date;
    const prev = ovForType(type, iso) || { rate: typeBaseRate(type), minStay: null, maxStay: null, closed: false, cta: false, ctd: false };
    const rateVal = parseFloat($("#rdRate").value);
    const minVal = parseInt($("#rdMinStay").value, 10);
    const maxRaw = $("#rdMaxStay").value.trim();
    const maxVal = maxRaw === "" ? null : parseInt(maxRaw, 10);
    const selVal = (id) => { const v = $(id).value; return v === "" ? null : v === "1"; };
    const closedVal = selVal("#rdClosed"), ctaVal = selVal("#rdCta"), ctdVal = selVal("#rdCtd");
    const hasRate = Number.isFinite(rateVal), hasMin = Number.isFinite(minVal), hasMax = maxRaw !== "";
    if (hasRate && rateVal < 0) { toast("Enter a valid rate", moneyCurrency + " per night, 0 or more", "warn"); return; }
    if (!hasRate && !hasMin && !hasMax && closedVal === null && ctaVal === null && ctdVal === null) {
      toast("Nothing to change", "Set a rate, stay limit, or a closed / CTA / CTD option", "warn"); return;
    }
    const entry = {
      rate: hasRate ? rateVal : prev.rate,
      minStay: hasMin ? (minVal > 0 ? minVal : null) : prev.minStay,
      maxStay: hasMax ? (maxVal > 0 ? maxVal : null) : prev.maxStay,
      closed: closedVal !== null ? closedVal : prev.closed,
      cta: ctaVal !== null ? ctaVal : prev.cta,
      ctd: ctdVal !== null ? ctdVal : prev.ctd
    };
    if (entry.minStay && entry.maxStay && entry.minStay > entry.maxStay) { toast("Check stay limits", "Minimum stay is longer than the maximum stay", "warn"); return; }
    rateOverrides[type.id + "|" + iso] = entry;
    if (window.SHDB && SHDB.hasLive() && !String(type.id).startsWith("demo-") && !String(type.id).startsWith("local-")) SHDB.upsertRateOverrides(type.id, [{ date: iso, ...entry }]).catch(() => toast("Rules saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderRates();
    toast(`${type.name} · ${iso}`, entry.closed ? "Closed (stop sell)" : `Rate ${money(entry.rate)}${entry.minStay ? " · min " + entry.minStay + "n" : ""}`, "ok");
  }
  else if (a === "rd-clear") {
    const type = ratesType();
    if (!type) return;
    delete rateOverrides[type.id + "|" + el.dataset.date];
    if (window.SHDB && SHDB.hasLive() && !String(type.id).startsWith("demo-") && !String(type.id).startsWith("local-")) SHDB.deleteRateOverride(type.id, el.dataset.date).catch(() => toast("Cleared locally only", "Supabase delete failed", "warn"));
    closeModal(); renderRates();
    toast(`${type.name} · ${el.dataset.date}`, `Back to nightly ${money(typeBaseRate(type))}`, "ok");
  }
  else if (a === "bulk-open") openBulkUpdater();
  else if (a === "bu-days-all") $$(".bu-dow").forEach((c) => { c.checked = true; });
  else if (a === "bu-days-none") $$(".bu-dow").forEach((c) => { c.checked = false; });
  else if (a === "bu-targets-all") $$("#buTargets input[type='checkbox']").forEach((c) => { c.checked = true; });
  else if (a === "bu-targets-none") $$("#buTargets input[type='checkbox']").forEach((c) => { c.checked = false; });
  else if (a === "bu-apply") {
    const from = $("#buFrom").value, to = $("#buTo").value;
    if (!from || !to) { toast("Pick the date range", "From and To are both needed", "warn"); return; }
    if (from > to) { toast("Check the range", "Start date must be before the end date", "warn"); return; }
    const dows = new Set($$(".bu-dow:checked").map((c) => +c.value));
    if (!dows.size) { toast("Pick at least one day", "Use the weekday checkboxes", "warn"); return; }
    const typeTargets = $$(".bu-type:checked").map((c) => roomTypes.find((t) => t.id === c.value)).filter(Boolean);
    const planTargets = $$(".bu-plan:checked").map((c) => c.value.split("|"));
    if (!typeTargets.length && !planTargets.length) { toast("Pick at least one room type or rate", "Use the middle checkboxes", "warn"); return; }
    const rateVal = parseFloat($("#buRate").value);
    const minVal = parseInt($("#buMinStay").value, 10);
    const maxRaw = $("#buMaxStay").value.trim();
    const maxVal = maxRaw === "" ? null : parseInt(maxRaw, 10);
    const selVal = (id) => { const v = $(id).value; return v === "" ? null : v === "1"; };
    const closedVal = selVal("#buClosed"), ctaVal = selVal("#buCta"), ctdVal = selVal("#buCtd");
    const hasRate = Number.isFinite(rateVal), hasMin = Number.isFinite(minVal), hasMax = maxRaw !== "";
    if (!hasRate && !hasMin && !hasMax && closedVal === null && ctaVal === null && ctdVal === null && !planTargets.length) {
      toast("Nothing to change", "Fill at least one field on the right", "warn"); return;
    }
    if (hasMin && hasMax && maxVal > 0 && minVal > maxVal) { toast("Check stay limits", "Minimum stay is longer than the maximum stay", "warn"); return; }
    // Rate plans: bulk-edit min/max stay only (their price is a % or $ difference).
    let plansUpdated = 0;
    planTargets.forEach(([typeId, planId]) => {
      const t = roomTypes.find((x) => x.id === typeId);
      if (!t) return;
      const tn = normalizeRoomType(t);
      const plan = tn.ratePlans.find((p) => p.id === planId);
      if (!plan) return;
      if (hasMin) plan.minStay = minVal;
      if (hasMax) plan.maxStay = maxVal > 0 ? maxVal : 0;
      t.ratePlans = tn.ratePlans;
      plansUpdated++;
      persistRoomType(t);
    });
    // Room types: merge changes into each matching date's rules.
    let nightsUpdated = 0;
    const byType = new Map();
    typeTargets.forEach((type) => {
      const entries = [];
      const d = new Date(from + "T12:00:00"), end = new Date(to + "T12:00:00");
      while (d <= end) {
        if (dows.has(d.getDay())) {
          const iso = isoLocal(d);
          const prev = ovForType(type, iso) || { rate: typeBaseRate(type), minStay: null, maxStay: null, closed: false, cta: false, ctd: false };
          const next = {
            rate: hasRate ? rateVal : prev.rate,
            minStay: hasMin ? (minVal > 0 ? minVal : null) : prev.minStay,
            maxStay: hasMax ? (maxVal > 0 ? maxVal : null) : prev.maxStay,
            closed: closedVal !== null ? closedVal : prev.closed,
            cta: ctaVal !== null ? ctaVal : prev.cta,
            ctd: ctdVal !== null ? ctdVal : prev.ctd
          };
          rateOverrides[type.id + "|" + iso] = next;
          entries.push({ date: iso, ...next });
          nightsUpdated++;
        }
        d.setDate(d.getDate() + 1);
      }
      if (entries.length) byType.set(type, entries);
    });
    if (window.SHDB && SHDB.hasLive()) {
      for (const [type, entries] of byType) {
        if (!String(type.id).startsWith("demo-") && !String(type.id).startsWith("local-")) SHDB.upsertRateOverrides(type.id, entries).catch(() => toast("Some rates saved locally only", "Supabase write failed", "warn"));
      }
    }
    closeModal(); renderRates();
    toast("Bulk update applied", `${nightsUpdated} nights${plansUpdated ? ` · ${plansUpdated} rate plan${plansUpdated > 1 ? "s" : ""}` : ""} updated`, "ok");
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
        booking_theme: studioTheme,
        brand_color: studioTheme.colors.brand,
        hero_image_url: studioHeroUrl || null,
        hero_focus_x: Math.round(studioHeroFocus.x),
        hero_focus_y: Math.round(studioHeroFocus.y),
        ga_measurement_id: $("#bkGa").value.trim() || null,
        booking_redirect_url: $("#bkRedirect").value.trim() || null,
        booking_by_type: !!($("#bkByType") && $("#bkByType").checked),
        ...($("#bkAddressMode") ? { guest_address_mode: $("#bkAddressMode").value } : {}),
        deposit_enabled: !!($("#bkDepositOn") && $("#bkDepositOn").checked),
        deposit_percent: Math.min(100, Math.max(1, parseInt($("#bkDepositPct") ? $("#bkDepositPct").value : "25", 10) || 25))
      }).then(() => { if (liveTenant) { liveTenant.booking_headline = $("#bkHead").value.trim() || liveTenant.booking_headline; liveTenant.deposit_enabled = !!($("#bkDepositOn") && $("#bkDepositOn").checked); } renderSetupUI(); updateEmbed({ slug: slugVal }); toast("Booking page published", "Settings saved to Supabase", "ok"); })
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
        const d = await fnInvoke("stripe-connect", { tenant_id: SHDB.tenantId() });
        if (d.onboarding_url) { location.href = d.onboarding_url; return; }
        toast("Stripe Connect not ready", "Check function secrets, then retry", "warn");
      } catch (err) { toast("Stripe Connect not ready", err.message || "Deploy stripe-connect with Stripe secrets", "warn"); }
    })();
  }
  else if (a === "invite") {
    if (!window.SHDB || !SHDB.hasLive()) { toast("Sign in live first", "Invites are tied to your property account", "warn"); return; }
    openModal({
      title: "Invite your team", sub: "They get an email, create a free account, and land in this property — no card or trial",
      body: `<div class="field"><label>Email</label><input class="input" id="invEmail" type="email" placeholder="teammate@email.com"></div>
        <div class="field"><label>Role</label><select class="select" id="invRole">
          <option value="cleaner">Cleaner — housekeeping board, turnover list and maintenance tickets</option>
          <option value="maintenance">Maintenance — maintenance tickets only</option>
          <option value="staff">Staff — front desk: reservations, guests and payments</option>
          <option value="admin">Admin — everything except billing ownership</option>
        </select><span class="help">The invite is stored for this property and matched to their account email when they sign up.</span></div>
        <div class="section-title" style="margin:16px 0 8px"><h2 style="font-size:14px">Pending invites</h2><div class="line"></div></div>
        <div id="invPending"><p class="hint">Loading…</p></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Close</button>
        <button class="btn btn-primary btn-sm" data-action="invite-send" type="button">Send invite email</button>`,
      wide: true
    });
    renderInvPending();
  }
  else if (a === "invite-send") {
    const email = $("#invEmail").value.trim().toLowerCase();
    const role = $("#invRole").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Enter their email", "The invite is matched to this address", "warn"); return; }
    (async () => {
      try {
        const d = await fnInvoke("send-email", { action: "team_invite", tenant_id: SHDB.tenantId(), email, role });
        toast("Invite sent", `${email} · ${role}`, d.sent ? "ok" : "warn");
        $("#invEmail").value = "";
        renderInvPending(); renderTeamInvites();
      } catch (e) { toast("Could not send invite", e.message, "warn"); }
    })();
  }
  else if (a === "switch-property") {
    const id = el.dataset.id;
    if (!id || id === (liveTenant && liveTenant.id)) { closeModal(); return; }
    SHDB.rememberTenant(id);
    location.reload(); // a clean load: nothing from the last property lingers
  }
  else if (a === "property-settings") { closeModal(); goto("settings"); }
  else if (a === "add-property") openPropertySetup(true);
  else if (a === "member-remove") {
    const { user, email } = el.dataset;
    confirmAction(`Remove ${email} from the team?`,
      `They lose access to ${esc(tenantDisplayName || "this property")} right away. You can invite them again later.`, "Remove",
      () => applyMemberChange(() => SHDB.removeMember(user), "Removed from the team", `${email} no longer has access.`));
  }
  else if (a === "invite-revoke") {
    if (window.SHDB) SHDB.deleteInvite(el.dataset.id).then(() => { renderInvPending(); renderTeamInvites(); toast("Invite revoked", "That link no longer joins anyone", "ok"); }).catch(() => toast("Revoke failed", "Supabase write failed", "warn"));
  }
  else if (a === "setup-step") {
    const step = computeSetup().steps.find((s) => s.key === el.dataset.key);
    if (!step) return;
    if (step.view) goto(step.view);
    if (step.key === "profile") setTimeout(() => {
      const card = $("#propertyCard"); if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      const name = $("#pfName"); if (name) name.focus({ preventScroll: true });
    }, 120);
    if (step.action === "connect-bank") { const b = document.querySelector('#checklist [data-action="connect-bank"]'); if (b) b.click(); else goto("settings"); }
    if (step.action === "invite") { const b = document.querySelector('#checklist [data-action="invite"]'); if (b) b.click(); else goto("settings"); }
  }
  else if (a === "load-example-terms") {
    const field = $("#pfTerms");
    if (!field) return;
    field.value = [
      "Wash your dishes and put them away dry.",
      "Put dirty towels in the shower when you leave.",
      "Put your trash in the dumpster on your way out, and please tie the bags shut.",
      "No smoking in cabins. Put cigarette butts in the receptacle on the porch, not on the grass.",
      "Do not throw food out in the yard.",
      "Do not dump grease on the lawn.",
      "No dogs allowed on beds. Thank you for helping us keep the linens clean. Pets must be kenneled if left in cabins unattended. If there is evidence of pets on beds, an extra cleaning fee will be assessed.",
      "Pet owners must pick up after their pets inside and outside the cabins during their stay.",
      "Extreme uncleanliness in or around cabins will be charged an additional cleaning fee of up to $100.",
      "Thank you for staying with us, and please come again!"
    ].join("\n");
    field.focus();
    toast("Example terms loaded", "Edit anything that does not fit your property, then save", "ok");
  }
  else if (a === "setup-property") {
    const name = $("#obPropertyName") ? $("#obPropertyName").value.trim() : "";
    if (!name) { toast("Give your property a name", "It becomes your booking page title", "warn"); return; }
    if (!window.SHAuth || !SHAuth.createProperty) { toast("Please log in again", "Your session needs a refresh before setup", "warn"); return; }
    el.disabled = true; el.textContent = "Creating…";
    SHAuth.createProperty(name)
      .then(async (tenant) => {
        const switching = !!(liveTenant && liveTenant.id); // adding a second property
        SHDB.rememberTenant(tenant.id); // open the new one, now and after checkout
        closeModal();
        toast("Property created", name + " · now start your free trial", "ok");
        const started = await startTrialCheckout(tenant.id);
        if (started) return;
        if (switching) { flashNext("Property created", "Finish your trial setup anytime from Settings → Plan and billing"); location.reload(); }
        else loadLiveIntoUI();
      })
      .catch((err) => {
        el.disabled = false; el.textContent = "Create property & continue";
        toast("Could not create the property", err.message || "Try a different name", "err");
      });
  }
  else if (a === "save-settings") {
    const v = (id) => { const el = $(id); return el ? el.value.trim() : ""; };
    const url = (id) => { const s = v(id); return s && !/^https?:\/\//i.test(s) ? "https://" + s : s; };
    const intOrNull = (id) => { const n = parseInt(v(id), 10); return Number.isFinite(n) ? n : null; };
    if (!v("#pfName")) { toast("Property name is required", "It shows on your booking page and receipts", "warn"); return; }
    const includedOccupants = intOrNull("#pfIncludedOccupants") ?? 2;
    const maximumTotalOccupants = intOrNull("#pfMaximumTotalOccupants");
    if (includedOccupants < 0 || (maximumTotalOccupants !== null && maximumTotalOccupants < 0)) { toast("Check occupancies", "Occupancy counts cannot be negative", "warn"); return; }
    if (maximumTotalOccupants !== null && includedOccupants > maximumTotalOccupants) { toast("Check occupancies", "Included occupants cannot exceed maximum total occupants", "warn"); return; }
    const minRate = parseFloat(v("#pfMinRoomRate"));
    const patch = {
      name: v("#pfName"), contact_email: v("#pfEmail") || null,
      address_line1: v("#pfAddress1") || null, address_line2: v("#pfAddress2") || null,
      postcode: v("#pfPostcode") || null, city: v("#pfCity") || null, state: v("#pfState") || null,
      country: v("#pfCountry") || null, tax_number: v("#pfTaxNumber") || null,
      phone: v("#pfPhone") || null, contact_phone: v("#pfContactPhone") || null,
      website_url: url("#pfWebsite") || null, facebook_url: url("#pfFacebook") || null,
      instagram_url: url("#pfInstagram") || null, twitter_url: url("#pfTwitter") || null, youtube_url: url("#pfYoutube") || null,
      description: v("#pfDesc") || null,
      rental_terms: v("#pfTerms") || null,
      star_rated: !!($("#pfStarRated") && $("#pfStarRated").checked),
      star_count: ($("#pfStarRated") && $("#pfStarRated").checked) ? intOrNull("#pfStars") : null,
      check_in_time: v("#pfCheckIn"), check_out_time: v("#pfCheckOut"),
      cancellation_policy: ["moderate", "flexible", "strict", "custom"][$("#pfPolicy").selectedIndex] || "moderate",
      cancellation_policy_text: ["moderate", "flexible", "strict", "custom"][$("#pfPolicy").selectedIndex] === "custom" ? (v("#pfPolicyText") || null) : null,
      included_occupants: includedOccupants,
      maximum_adults: intOrNull("#pfMaximumAdults"), maximum_children: intOrNull("#pfMaximumChildren"),
      maximum_infants: intOrNull("#pfMaximumInfants"), maximum_total_occupants: maximumTotalOccupants,
      min_room_rate_cents: Number.isFinite(minRate) ? Math.round(minRate * 100) : null,
      weekend_starts: v("#pfWeekendStarts") || "saturday",
      ...($("#pfCurrency") && !$("#pfCurrency").disabled ? { currency: SHMoney.code(v("#pfCurrency")) } : {}),
      allow_decimals: !!($("#pfAllowDecimals") && $("#pfAllowDecimals").checked),
      booking_email: v("#pfBookingEmail") || null, booking_cc_email: v("#pfBookingCc") || null,
      enquiry_email: v("#pfEnquiryEmail") || null, availability_email: v("#pfAvailEmail") || null,
      gdpr_consent: !!($("#pfGdpr") && $("#pfGdpr").checked)
    };
    tenantDisplayName = patch.name;
    const prevCurrency = moneyCurrency;
    if (liveTenant) Object.assign(liveTenant, patch);
    if (patch.currency && patch.currency !== prevCurrency) setCurrency(patch.currency);
    renderOverview();
    if ($("#bkName")) $("#bkName").value = patch.name;
    if (window.SHDB && SHDB.hasLive()) {
      SHDB.updateTenantSettings(patch).then(() => toast("Settings saved", "Property profile updated", "ok"))
        .catch((e) => {
          if (e && e.code === "currency_locked") {
            if (liveTenant) liveTenant.currency = prevCurrency;
            setCurrency(prevCurrency, { locked: true });
            toast("Currency not changed", e.details || "The currency is locked once payments are recorded.", "warn");
            return;
          }
          toast("Settings saved locally only", "Supabase write failed", "warn");
        });
    } else toast("Settings saved", "Property profile updated (demo)", "ok");
  }
  else if (a === "toggle-addon") {
    const ad = addons[+el.dataset.i]; ad.on = !ad.on; renderAddons();
    if (window.SHDB && ad.id) SHDB.setAddonActive(ad.id, ad.on).catch(() => toast("Visibility saved locally only", "Supabase write failed", "warn"));
  }
  else if (a === "del-addon") {
    const gone = addons[+el.dataset.i];
    if (!gone) return;
    confirmAction(`Remove “${gone.name}”?`, "Guests will no longer see this add-on at checkout. Existing reservations keep what they already booked.", "Remove add-on", () => {
      addons.splice(addons.indexOf(gone), 1); renderAddons();
      if (window.SHDB && gone.id) SHDB.deleteAddon(gone.id).catch(() => toast("Removed locally only", "Supabase delete failed", "warn"));
      toast(`Removed “${gone.name}”`, "It no longer shows at checkout", "warn");
    });
  }
  else if (a === "del-tax") {
    const gone = taxes[+el.dataset.i];
    if (!gone) return;
    confirmAction(`Remove “${gone.name}”?`, "New totals will be calculated without this tax or fee. Past reservations are not changed.", "Remove rule", () => {
      taxes.splice(taxes.indexOf(gone), 1); renderTaxes();
      if (window.SHDB && gone.id) SHDB.deleteTax(gone.id).catch(() => toast("Removed locally only", "Supabase delete failed", "warn"));
      toast(`Removed “${gone.name}”`, "Totals recalculated", "warn");
    });
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
    if (na.price < 0) { toast("Check the price", "Price cannot be negative", "warn"); return; }
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
        <div class="field"><label>Applies to</label><select class="select" id="txApplies"><option>Room + add-ons</option><option>Room only</option></select></div></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" data-action="save-tax" type="button">Add rule</button>`,
    });
  }
  else if (a === "save-tax") {
    const nt = { name: $("#txName").value.trim() || "Custom fee", kind: $("#txKind").value, value: parseFloat($("#txVal").value) || 0, applies: $("#txApplies") ? $("#txApplies").value : "Room + add-ons", on: true };
    taxes.push(nt);
    if (window.SHDB && SHDB.hasLive()) SHDB.createTax(nt).then((row) => { if (row) nt.id = row.id; }).catch(() => toast("Tax saved locally only", "Supabase write failed", "warn"));
    closeModal(); renderTaxes(); toast("Tax rule added", "Totals recalculated everywhere", "ok");
  }
  else if (a === "add-room") {
    const inheritLine = (t) => t ? `${t.name}: nightly ${money(typeBaseRate(t))} · sleeps ${typeSleeps(t)} — inherited from the type. Change them on the room type, not per room.` : "Pick a room type — its nightly rate and occupancy carry over to this room.";
    openModal({
      title: "Add a room or cabin", sub: "It appears on your booking page immediately",
      body: `<div class="form-2"><div class="field"><label>Code</label><input class="input" id="rmCode" placeholder="e.g. D1"></div>
        <div class="field"><label>Name</label><input class="input" id="rmName" placeholder="e.g. Juniper Lodge"></div></div>
        <div class="field"><label>Room type</label><select class="select" id="rmType">${roomTypes.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select><span class="help" id="rmInherit">${esc(inheritLine(roomTypes[0]))}</span></div>`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Cancel</button><button class="btn btn-primary btn-sm" data-action="save-room" type="button">Add unit</button>`
    });
    const typeSelEl = $("#rmType");
    if (typeSelEl) typeSelEl.addEventListener("change", () => {
      const t = roomTypes.find((x) => x.id === typeSelEl.value);
      const el = $("#rmInherit"); if (el) el.textContent = inheritLine(t);
    });
  }
  else if (a === "save-room") {
    const typeSel = roomTypes.find((t) => t.id === $("#rmType").value);
    const nr = { code: ($("#rmCode").value.trim() || "NEW").toUpperCase(), name: $("#rmName").value.trim() || "New unit", sleeps: typeSleeps(typeSel), rate: typeSel ? typeBaseRate(typeSel) : 150, typeId: typeSel && !String(typeSel.id).startsWith("demo-") ? typeSel.id : null };
    if (roomByCode(nr.code)) { toast("That code is already used", "Pick a different room code, e.g. D2", "warn"); return; }
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
  else toast("No matches", `Nothing found for “${e.target.value}”` + (olderMore ? " in recent stays. Older history loads from Reservations." : ""), "warn");
});

/* ---------------- Boot ---------------- */
renderToday(); renderMiniRooms(); renderReservations(); renderCalendar();
renderRooms(); renderHK(); renderMaintenance(); renderIcal(); renderFolios(); renderTxns();
renderAddons(); renderTaxes(); renderReports(); renderOverview(); renderRateMgmt();
bindStudio(); updateEmbed(null);

/* Stripe Connect sends owners back to /app.html?stripe=done|refresh. */
(function () {
  const s = new URLSearchParams(location.search).get("stripe");
  if (s !== "done" && s !== "refresh") return;
  history.replaceState(null, "", location.pathname);
  /* Delayed past the live-data setup router so the Stripe landing wins. */
  setTimeout(() => {
    goto("settings");
    if (s === "done") { syncStripeStatus(); toast("Stripe connected", "Payouts are on their way — check Plan & billing for status", "ok"); }
    else toast("Stripe link expired", "Open Settings and click Connect Stripe again for a fresh link", "warn");
  }, 2200);
})();

/* ---------------- Onboarding: property first, then card + 30-day trial ---------------- */
function clearAllData() {
  rooms.splice(0, rooms.length);
  reservations.splice(0, reservations.length);
  addons.splice(0, addons.length);
  taxes.splice(0, taxes.length);
  roomTypes = [];
  txns.splice(0, txns.length);
  rateOverrides = {};
  tickets = [];
  icalFeeds = [];
  liveSlug = ""; liveIcalToken = "";
}
function renderAll() {
  renderToday(); renderMiniRooms(); renderReservations(); renderCalendar();
  renderRooms(); renderHK(); renderMaintenance(); renderIcal(); renderFolios(); renderTxns();
  renderAddons(); renderTaxes(); renderReports(); renderOverview();
}

/* Currency: one per property; every amount re-renders in it. The setting
   locks after the first recorded payment (the database enforces this too). */
function setCurrency(code, { locked } = {}) {
  const changed = SHMoney.code(code) !== moneyCurrency;
  moneyCurrency = SHMoney.code(code);
  $$("[data-currency-code]").forEach((el) => { el.textContent = moneyCurrency; });
  const sel = $("#pfCurrency");
  if (sel) {
    sel.value = moneyCurrency;
    if (locked != null) sel.disabled = !!locked;
    const help = $("#pfCurrencyHelp");
    if (help) help.textContent = sel.disabled
      ? "Locked: this property has recorded payments, and past amounts would change meaning."
      : "Prices, payments, receipts and emails use this currency. It locks after your first payment.";
  }
  if (changed) { renderAll(); renderRateMgmt(); }
}
{
  const sel = $("#pfCurrency");
  if (sel) {
    sel.innerHTML = Object.entries(SHMoney.CURRENCIES).map(([c, name]) => `<option value="${c}">${c} · ${esc(name)}</option>`).join("");
    sel.value = moneyCurrency;
  }
}

/* Hide screens and owner/admin-only controls the signed-in role can't use. */
function applyRole() {
  const limited = !!ROLE_VIEWS[liveRole];
  if (limited) document.body.dataset.role = liveRole; else delete document.body.dataset.role;
  $$(".nav-btn[data-view]").forEach((b) => {
    if (b.id === "navAdmin") return; // System Admin has its own check
    b.hidden = !canSee(b.dataset.view);
  });
  // Section headings with nothing left under them, and owner setup progress.
  $$(".nav-label").forEach((label) => {
    const nav = label.nextElementSibling;
    if (nav && nav.classList.contains("nav")) label.hidden = !$$(".nav-btn", nav).some((b) => !b.hidden);
  });
  const setupMini = $(".onboard-mini");
  if (setupMini) setupMini.hidden = limited;
  const active = ($(".view.active") || {}).id;
  if (limited && active && !canSee(active.replace("view-", ""))) goto(ROLE_VIEWS[liveRole][0]);
}

/* Older reservations: the dashboard loads recent and upcoming stays plus any
   with a balance; history before that loads a page at a time. */
let olderOffset = 0, olderMore = false;
function renderOlderButton() {
  const btn = $("#resOlder");
  if (btn) btn.hidden = !olderMore;
}
async function loadOlderReservations() {
  const btn = $("#resOlder");
  btn.disabled = true; btn.textContent = "Loading…";
  try {
    const { rows, more } = await SHDB.loadOlderReservations(olderOffset);
    olderOffset += rows.length;
    olderMore = more;
    const have = new Set(reservations.map((r) => r.id));
    rows.forEach((r) => { if (!have.has(r.id)) reservations.push(r); });
    reservations.sort((a, b) => a.inN - b.inN);
    renderReservations();
    if (!rows.length) toast("No older reservations", "You're seeing your full history", "ok");
  } catch {
    toast("Couldn't load older reservations", "Check your connection and try again", "warn");
  } finally {
    btn.disabled = false; btn.textContent = "Load older reservations";
    renderOlderButton();
  }
}
$("#resOlder").addEventListener("click", loadOlderReservations);
function openPropertySetup(another = false) {
  openModal({
    title: another ? "Add a property" : "Set up your property",
    sub: another ? "It gets its own rooms, team and booking page. Name it, then add a card to start its 30-day free trial"
      : "Name it, then add a card to start your 30-day free trial",
    body: `
      <div class="field"><label>Property name</label><input class="input" id="obPropertyName" placeholder="e.g. Pinecrest Cabins"><span class="help">This becomes your booking page title. You can add address, photos, rooms and rates right after.</span></div>
      <div class="kv" style="margin-top:6px">
        <dt>Plan</dt><dd>SimpleHotelier · $30 / month</dd>
        <dt>Free trial</dt><dd>30 days · card required, nothing charged today</dd>
        <dt>Then</dt><dd>Add rooms, set rates, publish your booking page</dd>
      </div>`,
    foot: `<button class="btn btn-ghost btn-sm" data-close type="button">${another ? "Cancel" : "I'll do this later"}</button>
      <button class="btn btn-primary btn-sm" data-action="setup-property" type="button">Create property &amp; continue</button>`,
    wide: true
  });
  const inp = $("#obPropertyName"); if (inp) inp.focus();
}
async function startTrialCheckout(tenantId) {
  try {
    const c = window.SH_CONFIG || {};
    const token = (window.SHDB && SHDB.freshToken) ? await SHDB.freshToken() : (localStorage.getItem("sh_access_token") || c.SUPABASE_ANON_KEY);
    const res = await fetch((c.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/create-checkout", {
      method: "POST",
      headers: { apikey: c.SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, origin: location.origin })
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.url) { location.href = d.url; return true; }
    toast("Property created", "Finish your trial setup anytime from Settings → Plan and billing", "warn");
  } catch { toast("Property created", "Finish your trial setup anytime from Settings → Plan and billing", "warn"); }
  return false;
}
let checkoutToastShown = false, billingReminderShown = false;

/* Pending invites, shown in the invite modal and the Settings team card. */
function inviteRowsHTML(list) {
  if (!list.length) return `<p class="hint">No pending invites. Send one above and it will wait here until they sign up.</p>`;
  return list.map((i) => `
    <div class="kv-row" style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1;min-width:0"><strong style="font-size:13.5px">${esc(i.email)}</strong> <span class="pill">${esc(i.role)}</span> <span style="color:var(--muted);font-size:12.5px">invited ${esc(i.when)}</span></div>
      <button class="btn btn-ghost btn-xs" data-action="invite-revoke" data-id="${i.id}" type="button">Revoke</button>
    </div>`).join("");
}
async function renderInvPending() {
  const el = $("#invPending");
  if (!el || !window.SHDB || !SHDB.hasLive()) return;
  el.innerHTML = inviteRowsHTML(await SHDB.listInvites());
}
/* Settings → Team: who's on the property, their roles, and pending invites.
   Owners manage anyone; admins everyone but owners (the database enforces
   this, and keeps at least one owner). Nobody edits their own row here. */
function teamRowsHTML(members) {
  const iAmOwner = liveRole === "owner";
  const roles = (iAmOwner ? ["owner"] : []).concat(["admin", "staff", "cleaner", "maintenance"]);
  return members.map((m) => {
    const editable = !m.me && (iAmOwner || m.role !== "owner");
    const label = m.name || m.email;
    return `<div class="team-row">
      <span class="avatar">${esc(label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?")}</span>
      <div class="team-who"><strong>${esc(label)}${m.me ? ` <span class="tag">You</span>` : ""}</strong>${m.name ? `<span>${esc(m.email)}</span>` : ""}</div>
      ${editable
        ? `<select class="select team-role" data-user="${esc(m.userId)}" data-email="${esc(m.email)}" data-role="${esc(m.role)}" aria-label="Role for ${esc(label)}">${roles.map((r) => `<option value="${r}"${r === m.role ? " selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select>
           <button class="btn btn-ghost btn-xs" type="button" data-action="member-remove" data-user="${esc(m.userId)}" data-email="${esc(m.email)}">Remove</button>`
        : `<span class="pill">${esc(ROLE_LABELS[m.role] || m.role)}</span>`}
    </div>`;
  }).join("");
}
async function renderTeamInvites() {
  const el = $("#teamInvites");
  if (!el) return;
  if (!window.SHDB || !SHDB.hasLive()) { el.innerHTML = `<p class="hint">Sign in with your property account to manage your team.</p>`; return; }
  const [members, invites] = await Promise.all([SHDB.teamMembers().catch(() => []), SHDB.listInvites().catch(() => [])]);
  el.innerHTML = (members.length ? `<div class="team-list">${teamRowsHTML(members)}</div>` : "") +
    `<h4 class="team-sub">Pending invites</h4>` +
    (invites.length ? inviteRowsHTML(invites) : `<p class="hint">No pending invites. Invite cleaners and staff — they create a free account and join this property automatically.</p>`);
  liveMembersCount = members.length || liveMembersCount;
}
async function applyMemberChange(work, okTitle, okBody) {
  try {
    await work();
    toast(okTitle, okBody, "ok");
  } catch (e) {
    toast("Team not changed", (e && e.details) || "Check your connection and try again.", "warn");
  }
  renderTeamInvites();
}
document.addEventListener("change", (e) => {
  const sel = e.target.closest && e.target.closest(".team-role");
  if (!sel) return;
  const { user, email, role: before } = sel.dataset;
  const role = sel.value;
  const run = () => applyMemberChange(() => SHDB.setMemberRole(user, role), "Role updated", `${email} is now ${ROLE_LABELS[role]}.`);
  if (role === "owner") {
    sel.value = before; // only after they confirm
    confirmAction(`Make ${email} an owner?`,
      "Owners can manage billing and payouts, change anyone's role, and delete the property.", "Make owner", run);
  } else run();
});

/* Claim pending team invites for the signed-in user: the one in the invite
   link, or else any sent to their account email. Runs once per page. One
   login can belong to several properties, so this runs for people who
   already have one too (claimInviteAsMember). Resolves to the
   accept-invite response when something was joined, else null. */
let inviteClaimTried = false;
async function tryClaimInvite() {
  if (inviteClaimTried) return null;
  inviteClaimTried = true;
  const forget = () => { try { localStorage.removeItem("sh_invite_token"); } catch { /* no storage */ } };
  try {
    let token = "";
    try { token = localStorage.getItem("sh_invite_token") || ""; } catch { /* no storage */ }
    const d = await fnInvoke("accept-invite", token ? { token } : {});
    forget(); // joined, or the link's invite is used up or expired
    if (d && d.joined && d.tenant && d.tenant.id) return d;
  } catch (e) {
    // Kept on a mismatch: they may sign out and back in with the invited email.
    if (e && /was sent to/i.test(e.message || "")) toast("Use the invited email", e.message, "warn");
  }
  return null;
}
const joinedNames = (d) => (d.tenants && d.tenants.length ? d.tenants : [d.tenant]).map((t) => t.name).filter(Boolean).join(", ") || "the property";
/* Open the property they just joined, with a note that survives the reload. */
function openJoined(d) {
  flashNext("Welcome to the team", `You joined ${joinedNames(d)} as ${ROLE_LABELS[d.role] || d.role}`);
  SHDB.rememberTenant(d.tenant.id);
  location.reload();
}
/* Already on a property: claim an invite link they followed (and open that
   property), or once a browser session pick up invites sent to their email
   (joined quietly; they switch from the property menu). */
function claimInviteAsMember() {
  let token = "", checked = false;
  try {
    token = localStorage.getItem("sh_invite_token") || "";
    checked = sessionStorage.getItem("sh_invites_checked") === "1";
    sessionStorage.setItem("sh_invites_checked", "1");
  } catch { /* no storage */ }
  if (!token && checked) return;
  tryClaimInvite().then((d) => {
    if (!d) return;
    const fresh = (d.tenants || [d.tenant]).filter((t) => !liveProperties.some((p) => p.id === t.id));
    if (!fresh.length) return; // already a member there
    if (token) { openJoined(d); return; }
    fresh.forEach((t) => liveProperties.push({ id: t.id, name: t.name, role: t.role || d.role }));
    toast(`You joined ${fresh.map((t) => t.name).join(", ")}`, "Switch to it from the property menu at the top of the sidebar", "ok");
  });
}
/* A note that survives one reload (switching property, joining a team). */
function flashNext(title, body) {
  try { sessionStorage.setItem("sh_flash", JSON.stringify({ title, body })); } catch { /* no storage */ }
}
function showFlash() {
  let f = null;
  try { f = JSON.parse(sessionStorage.getItem("sh_flash") || "null"); sessionStorage.removeItem("sh_flash"); } catch { /* no storage */ }
  if (f && f.title) setTimeout(() => toast(f.title, f.body || "", "ok"), 700);
}

/* Sidebar property menu: every property this login belongs to, and a way to
   add another. Switching reloads so nothing from the last one lingers. */
function openPropertySwitcher() {
  const current = liveTenant && liveTenant.id;
  const list = liveProperties.length ? liveProperties : (current ? [{ id: current, name: tenantDisplayName, role: liveRole }] : []);
  openModal({
    title: "Your properties",
    sub: list.length > 1 ? "Pick the property to work on. Each has its own rooms, team and bookings." : "Properties you own or work at show up here.",
    body: `<div class="prop-list">${list.map((p) => {
      const on = p.id === current;
      return `<button class="prop-row${on ? " current" : ""}" type="button" data-action="switch-property" data-id="${esc(p.id)}"${on ? ` aria-current="true"` : ""}>
        <span class="prop-dot" aria-hidden="true"></span>
        <span class="prop-row-name">${esc(p.name)}</span>
        <span class="pill">${esc(ROLE_LABELS[p.role] || p.role)}</span>
        ${on ? `<span class="prop-row-open">Open</span>` : ""}
      </button>`;
    }).join("")}</div>`,
    foot: `${canSee("settings") ? `<button class="btn btn-ghost btn-sm" type="button" data-action="property-settings">Property settings</button>` : ""}
      <button class="btn btn-primary btn-sm" type="button" data-action="add-property">Add a property</button>`
  });
}

/* Demo mode is explicit and local-only: it is entered only via the
   "Explore the demo first" button (sessionStorage flag, set in js/auth.js),
   shows the built-in sample data, and never reads or writes a real
   property. Every other path loads only the signed-in member's property;
   a failed load shows an empty app, never the demo data. */
function demoMode() {
  try { return sessionStorage.getItem("sh_demo") === "1"; } catch { return false; }
}
function renderDemoBanner() {
  const b = $("#demoBanner");
  if (b) b.hidden = !demoMode();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#demoExit")) return;
  try { sessionStorage.removeItem("sh_demo"); } catch { /* no storage */ }
  location.reload();
});
/* Live Supabase data for the signed-in member's property only. */
function loadLiveIntoUI() {
  const statusEl = $("#dbStatus");
  renderDemoBanner();
  if (demoMode()) {
    if (statusEl) statusEl.textContent = "Data source: demo data (sample property — nothing here is real, saved, or connected to an account)";
    return;
  }
  if (!window.SHDB || !SHDB.configured()) {
    if (statusEl) statusEl.textContent = "Data source: demo data (add your Supabase keys in js/config.js)";
    return;
  }
  SHDB.loadLiveData().then((live) => {
    if (!live) {
      // Configured backend failed: show nothing rather than sample data on
      // what may be a real account's screen.
      clearAllData();
      renderAll();
      if (statusEl) statusEl.textContent = "Could not load your property data — check your connection and reload. No sample data is shown on a real account.";
      return;
    }
    if (!live.tenant) {
      clearAllData();
      renderAll();
      if (!live.user) {
        // Anonymous: the login gate handles sign-in / explicit demo entry.
        if (statusEl) statusEl.textContent = "Sign in to load your property.";
        return;
      }
      // Signed in but no property yet. An invited teammate joins their
      // property here instead of creating one (no card, no trial).
      if (statusEl) statusEl.textContent = "Signed in as " + live.user.email + " — set up your property to get started.";
      tryClaimInvite().then((d) => { if (d) openJoined(d); else openPropertySetup(); });
      return;
    }
    // Real account: replace wholesale, even when empty — demo data must never leak in.
    rooms.splice(0, rooms.length, ...live.rooms);
    reservations.splice(0, reservations.length, ...live.reservations);
    addons.splice(0, addons.length, ...live.addons);
    taxes.splice(0, taxes.length, ...live.taxes);
    roomTypes = (live.roomTypes || []).map(normalizeRoomType);
    if (live.rateOverrides) { rateOverrides = {}; live.rateOverrides.forEach((o) => { if (o.typeId) rateOverrides[o.typeId + "|" + o.date] = { rate: o.rate, minStay: o.minStay != null ? o.minStay : null, maxStay: o.maxStay != null ? o.maxStay : null, closed: !!o.closed, cta: !!o.cta, ctd: !!o.ctd }; }); }
    txns.splice(0, txns.length, ...(live.txns || []));
    tickets = live.tickets || [];
    icalFeeds = live.icalFeeds || [];
    liveSlug = live.tenant.slug || "";
    liveIcalToken = live.tenant.ical_token || "";
    tenantDisplayName = live.tenant.name || "";
    liveTenant = live.tenant;
    liveProperties = live.memberships || [];
    window.SH_TENANT_ID = live.tenant.id; // error reports name the property
    liveRole = ROLE_LABELS[live.role] ? live.role : "staff";
    turnovers = live.turnovers || [];
    applyRole();
    olderOffset = 0;
    olderMore = !!live.olderReservations;
    renderOlderButton();
    moneyCurrency = SHMoney.code(live.tenant.currency);
    liveMembersCount = live.membersCount != null ? live.membersCount : 1;
    renderToday(); renderMiniRooms(); renderReservations(); renderCalendar();
    renderRooms(); renderHK(); renderMaintenance(); renderIcal(); renderFolios(); renderTxns(); renderAddons(); renderTaxes(); renderReports(); renderOverview(); renderRateMgmt();
    renderTeamInvites();
    syncStripeStatus();
    if (live.user) {
      $("#userName").textContent = live.user.email;
      $("#userRole").textContent = ROLE_LABELS[liveRole] + " · " + live.tenant.name;
      $("#userAvatar").textContent = (live.user.email || "U").slice(0, 2).toUpperCase();
    }
    if ($("#bkGa")) $("#bkGa").value = live.tenant.ga_measurement_id || "";
    if ($("#bkRedirect")) $("#bkRedirect").value = live.tenant.booking_redirect_url || "";
    studioTheme = SHTheme.normalize(live.tenant.booking_theme);
    renderStudioDesign();
    studioHeroUrl = live.tenant.hero_image_url || "";
    if (live.tenant.hero_focus_x != null) studioHeroFocus.x = Math.min(100, Math.max(0, Number(live.tenant.hero_focus_x) || 0));
    if (live.tenant.hero_focus_y != null) studioHeroFocus.y = Math.min(100, Math.max(0, Number(live.tenant.hero_focus_y) || 0));
    applyStudioPreview();
    if ($("#bkDepositOn")) $("#bkDepositOn").checked = !!live.tenant.deposit_enabled;
    if ($("#bkByType")) $("#bkByType").checked = live.tenant.booking_by_type !== false;
    if ($("#bkAddressMode")) $("#bkAddressMode").value = live.tenant.guest_address_mode || "off";
    if ($("#bkDepositPct") && live.tenant.deposit_percent) $("#bkDepositPct").value = live.tenant.deposit_percent;
    if ($("#bkName")) $("#bkName").value = live.tenant.name || "";
    if (live.tenant.slug && $("#bkUrl")) $("#bkUrl").value = live.tenant.slug + ".simplehotelier.com";
    if (live.tenant.slug && $("#bkUrlPrev")) $("#bkUrlPrev").textContent = live.tenant.slug + ".simplehotelier.com";
    if (live.tenant.booking_headline && $("#bkHead")) $("#bkHead").value = live.tenant.booking_headline;
    if (live.tenant.booking_subheading && $("#bkSub")) $("#bkSub").value = live.tenant.booking_subheading;
    setPreviewSrc();
    updateEmbed(live.tenant);
    if ($("#pfName")) $("#pfName").value = live.tenant.name || "";
    if ($("#pfEmail")) $("#pfEmail").value = live.tenant.contact_email || "";
    if ($("#pfCheckIn")) $("#pfCheckIn").value = live.tenant.check_in_time || "3:00 PM";
    if ($("#pfCheckOut")) $("#pfCheckOut").value = live.tenant.check_out_time || "11:00 AM";
    setCurrency(live.tenant.currency, { locked: !!live.hasPayments });
    if ($("#pfPolicy")) {
      const ix = ["moderate", "flexible", "strict", "custom"].indexOf(live.tenant.cancellation_policy);
      $("#pfPolicy").selectedIndex = ix >= 0 ? ix : 0;
      const wrap = $("#pfPolicyCustomWrap"); if (wrap) wrap.hidden = live.tenant.cancellation_policy !== "custom";
      if (live.tenant.cancellation_policy_text && $("#pfPolicyText")) $("#pfPolicyText").value = live.tenant.cancellation_policy_text;
    }
    {
      const T = live.tenant;
      const set = (id, val) => { const el = $(id); if (el && val != null) el.value = val; };
      const chk = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
      set("#pfAddress1", T.address_line1); set("#pfAddress2", T.address_line2);
      set("#pfPostcode", T.postcode); set("#pfCity", T.city); set("#pfState", T.state);
      if (T.country && $("#pfCountry")) { const c = $("#pfCountry"); if (![...c.options].some((o) => o.value === T.country)) c.add(new Option(T.country, T.country)); c.value = T.country; }
      set("#pfTaxNumber", T.tax_number);
      set("#pfPhone", T.phone); set("#pfContactPhone", T.contact_phone);
      set("#pfWebsite", T.website_url); set("#pfFacebook", T.facebook_url); set("#pfInstagram", T.instagram_url);
      set("#pfTwitter", T.twitter_url); set("#pfYoutube", T.youtube_url);
      set("#pfDesc", T.description);
      set("#pfTerms", T.rental_terms);
      chk("#pfStarRated", T.star_rated); if (T.star_count) set("#pfStars", String(T.star_count));
      set("#pfIncludedOccupants", T.included_occupants ?? 2);
      set("#pfMaximumAdults", T.maximum_adults); set("#pfMaximumChildren", T.maximum_children);
      set("#pfMaximumInfants", T.maximum_infants); set("#pfMaximumTotalOccupants", T.maximum_total_occupants);
      if (T.min_room_rate_cents != null) set("#pfMinRoomRate", (T.min_room_rate_cents / 100).toFixed(2));
      set("#pfWeekendStarts", T.weekend_starts || "saturday");
      chk("#pfAllowDecimals", T.allow_decimals !== false);
      set("#pfBookingEmail", T.booking_email); set("#pfBookingCc", T.booking_cc_email);
      set("#pfEnquiryEmail", T.enquiry_email); set("#pfAvailEmail", T.availability_email);
      chk("#pfGdpr", T.gdpr_consent);
    }
    if (live.tenant.logo_url && $("#logoPreview")) { $("#logoPreview").src = live.tenant.logo_url; $("#logoPreview").hidden = false; const le = $("#logoEmpty"); if (le) le.style.display = "none"; }
    renderRates();
    if ($("#billStatus")) $("#billStatus").textContent = live.tenant.subscription_status || "trialing";
    if ($("#billPeriod")) $("#billPeriod").textContent = live.tenant.current_period_end ? new Date(live.tenant.current_period_end).toLocaleDateString() : "-";
    if (statusEl) statusEl.textContent = "Data source: Supabase · " + live.tenant.name + " (live" + (live.user ? " · " + live.user.email : "") + ")";
    toast("Connected to Supabase", live.tenant.name + " loaded live", "ok");
    showFlash();
    claimInviteAsMember();
    if (!setupRouted) {
      setupRouted = true;
      if (!ROLE_VIEWS[liveRole] && computeSetup().pct < 100) goto("setup");
      else if (ROLE_VIEWS[liveRole] && !canSee(($(".view.active") || {}).id?.replace("view-", ""))) goto(ROLE_VIEWS[liveRole][0]);
    }
    if (!checkoutToastShown) {
      checkoutToastShown = true;
      const co = new URLSearchParams(location.search).get("checkout");
      if (co === "success") setTimeout(() => toast("Your 30-day free trial is active", "$30/month after the trial · manage it in Settings", "ok"), 600);
      else if (co === "cancelled") setTimeout(() => toast("Checkout not finished", "Start your free trial anytime from Settings → Plan and billing", "warn"), 600);
      else if (!ROLE_VIEWS[liveRole] && !live.tenant.stripe_customer_id && !billingReminderShown) {
        billingReminderShown = true;
        setTimeout(() => toast("One step left: start your free trial", "Add a card in Settings → Plan and billing · 30 days free, then $30/month", "warn"), 900);
      }
    }
  });
}
loadLiveIntoUI();
window.addEventListener("sh-auth", (e) => {
  loadLiveIntoUI();
  toast("Welcome" + (e.detail && e.detail.user ? ", " + e.detail.user.email : ""), "Loading your property…", "ok");
});
