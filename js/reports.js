/* SimpleHotelier — Reports: Revenue, Statistics, Occupancy, Guests, Extras,
   Tax, Accounting, Balances due, Arrivals & departures.
   Earned basis: a stay's money is spread evenly over its nights and a period
   counts the nights inside it, so a week-long stay shows up in every week it
   touches. Firm bookings only (confirmed, in-house, checked out); requests
   waiting for confirmation and cancellations are counted apart. Calendar
   imports (Airbnb, Vrbo) fill nights but carry no money.
   Live properties use the bookings already loaded when they cover the
   period, otherwise fetch it (js/db.js report*). Demo mode reads the samples.
   Loaded after js/app.js and uses its helpers and data ($, esc, money, pill,
   reservations, rooms, taxes, rateOverrides, addDays, isoLocal, dstr…). */
"use strict";

const REP_ICON = {
  revenue: '<path d="M4 20V10M10 20V4M16 20v-8M21 20H3"/>',
  statistics: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  occupancy: '<path d="M2 18v-6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6M2 15h20M6 10V7h5v3"/>',
  guests: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1M16 4.3a3.5 3.5 0 0 1 0 7.4M21.5 20v-1a5 5 0 0 0-3.5-4.8"/>',
  extras: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z"/>',
  tax: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  accounting: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M8 7h8M8 11h6"/>',
  balances: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5M12 16h.01"/>',
  daily: '<path d="M9 3h6v3H9z"/><path d="M9 4.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-3M9 12h6M9 16h4"/>'
};
/* range: a period of nights ("range"), one day ("day") or none (as of now). */
const REPORTS = [
  { key: "revenue", label: "Revenue", range: "range", sub: "Revenue before tax, occupancy and where bookings come from" },
  { key: "statistics", label: "Statistics", range: "range", sub: "Room-nights, occupancy, length of stay, lead time, rates and cancellations" },
  { key: "occupancy", label: "Occupancy", range: "range", sub: "Occupancy by week, by day of the week and by unit" },
  { key: "guests", label: "Guests", range: "range", sub: "Each guest's stays, nights and revenue (stays arriving in the period)" },
  { key: "extras", label: "Extras", range: "range", sub: "Add-ons bought with stays arriving in the period" },
  { key: "tax", label: "Tax", range: "range", sub: "Tax by month and by rule, on the nights in the period" },
  { key: "accounting", label: "Accounting", range: "range", sub: "Sales by account and payments received, ready for QuickBooks or your bookkeeper" },
  { key: "balances", label: "Balances due", range: "", sub: "Every booking that still owes money, as of today" },
  { key: "daily", label: "Arrivals & departures", range: "day", sub: "Who arrives, leaves and stays over on a day" }
];
const REP_PRESETS = [["last7", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"], ["month", "This month"],
  ["lastmonth", "Last month"], ["next30", "Next 30 days"], ["year", "This year"], ["lastyear", "Last year"], ["all", "All time"], ["custom", "Custom dates"]];
const REP_SOURCES = [["direct", "Direct / website", "#0c3b3c"], ["phone", "Phone", "#c98a2e"], ["walkin", "Walk-in", "#7fa8a3"],
  ["airbnb", "Airbnb", "#d4776b"], ["vrbo", "Vrbo", "#4f6fa8"], ["other", "Other", "#b9c8c3"]];

const r2 = (v) => Math.round(v * 100) / 100;
// Midnight to midnight: a daylight-saving day is 23 or 25 hours, which rounds away.
const repOff = (iso) => Math.round((new Date(iso + "T00:00:00") - TODAY) / dayMs);
const repIso = (off) => isoLocal(addDays(off));
const repFirm = (r) => r.status === "confirmed" || r.status === "checked-in" || r.status === "checked-out";
const repBlock = (r) => !!r.icalFeedId;
const repPct = (v) => `${Math.round(v * 1000) / 10}%`;
const repPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/* Nights of a stay inside [F, T] (day offsets, inclusive), or null. */
function repSpan(r, F, T) {
  const a = Math.max(r.inN, F), b = Math.min(r.outN - 1, T);
  return b >= a ? [a, b] : null;
}
function presetRange(key) {
  const t = TODAY, y = t.getFullYear(), m = t.getMonth();
  const off = (d) => Math.round((d - t) / dayMs);
  const span = (a, b) => ({ from: repIso(a), to: repIso(b) });
  if (key === "last7") return span(-6, 0);
  if (key === "last90") return span(-89, 0);
  if (key === "next30") return span(1, 30);
  if (key === "month") return span(off(new Date(y, m, 1)), off(new Date(y, m + 1, 0)));
  if (key === "lastmonth") return span(off(new Date(y, m - 1, 1)), off(new Date(y, m, 0)));
  if (key === "year") return span(off(new Date(y, 0, 1)), off(new Date(y, 11, 31)));
  if (key === "lastyear") return span(off(new Date(y - 1, 0, 1)), off(new Date(y - 1, 11, 31)));
  return span(-29, 0);
}
let repState = { tab: "revenue", preset: "last30", ...presetRange("last30"), day: isoLocal(TODAY), query: "" };

/* ---------------------------------------------------------------- money */
/* A booking's money before tax, and its tax. Live bookings carry the tax they
   were charged; demo ones don't, so it is backed out with the current rules. */
function stayMoney(r) {
  const n = Math.max(1, r.outN - r.inN);
  if (r.tax != null) return { n, tax: r.tax, net: r.total - r.tax };
  const on = taxes.filter((t) => t.on);
  const pct = on.filter((t) => t.kind === "percent").reduce((s, t) => s + (Number(t.value) || 0), 0);
  const flat = on.filter((t) => t.kind !== "percent").reduce((s, t) => s + (Number(t.value) || 0), 0) * n;
  const net = Math.max(0, (r.total - flat) / (1 + pct / 100));
  return { n, tax: r.total - net, net };
}
/* How a booking's tax divides between the tax rules, worked out the way
   pricing does (percent of the room, or of everything; flat per night) and
   scaled to what was actually charged. Exact unless the rules changed since. */
function taxSplit(r, m) {
  const on = taxes.filter((t) => t.on);
  const room = r.subtotal != null ? r.subtotal - (r.discount || 0) : m.net;
  const all = r.subtotal != null ? room + (r.extras || 0) + (r.extraPerson || 0) : m.net;
  const est = on.map((t) => t.kind === "percent"
    ? (/room only/i.test(t.applies || "") ? room : all) * (Number(t.value) || 0) / 100
    : (Number(t.value) || 0) * m.n);
  const sum = est.reduce((s, v) => s + v, 0);
  return sum > 0 ? on.map((t, i) => [t.name, m.tax * est[i] / sum]) : m.tax ? [["Tax", m.tax]] : [];
}
const paidShare = (r) => (r.total > 0 ? Math.min(1, Math.max(0, r.paid / r.total)) : 0);
/* The parts of a booking's price: room (before discount), extra-person fees,
   extras, discount. Demo bookings only know their total. */
function stayParts(r, m) {
  return r.subtotal != null
    ? { room: r.subtotal, extraPerson: r.extraPerson || 0, extras: r.extras || 0, discount: r.discount || 0 }
    : { room: m.net, extraPerson: 0, extras: 0, discount: 0 };
}

/* Room-nights the Rate Calendar closed (stop-sell) that nobody occupied. */
function repClosed(data, F, T) {
  const occupied = new Set();
  data.res.forEach((r) => {
    const s = repFirm(r) && repSpan(r, F, T);
    if (s) for (let o = s[0]; o <= s[1]; o++) occupied.add(r.room + "|" + o);
  });
  const closed = new Set();
  data.closures.forEach((c) => {
    const o = repOff(c.date);
    if (o < F || o > T) return;
    rooms.filter((u) => u.typeId && u.typeId === c.typeId).forEach((u) => { if (!occupied.has(u.code + "|" + o)) closed.add(u.code + "|" + o); });
  });
  return closed;
}
/* Chart buckets: nights up to a month, weeks up to six months, then months. */
function repBuckets(F, T) {
  const span = T - F + 1, mode = span <= 31 ? "night" : span <= 186 ? "week" : "month";
  const buckets = [], at = new Map();
  for (let o = F; o <= T; o++) {
    const d = addDays(o);
    let key, label, title;
    if (mode === "night") { key = o; label = String(d.getDate()); title = dstr(d); }
    else if (mode === "week") { const w = Math.floor((o - F) / 7); key = "w" + w; label = "W" + (w + 1); title = "Week of " + dstr(addDays(F + w * 7)); }
    else {
      key = d.getFullYear() * 12 + d.getMonth();
      label = d.toLocaleDateString("en-US", { month: "short" }) + (span > 366 ? " ’" + String(d.getFullYear()).slice(2) : "");
      title = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    if (!buckets.length || buckets[buckets.length - 1].key !== key) buckets.push({ key, label, title, iso: isoLocal(d), value: 0 });
    at.set(o, buckets[buckets.length - 1]);
  }
  return { mode, buckets, at: (o) => at.get(o) };
}

/* ---------------------------------------------------------------- reports */
function computeRevenue(data, F, T) {
  const span = T - F + 1, B = repBuckets(F, T), closed = repClosed(data, F, T);
  const stays = data.res.filter((r) => repFirm(r) && repSpan(r, F, T));
  const requests = data.res.filter((r) => r.status === "pending" && !r.awaitingCard && repSpan(r, F, T)).length;
  let revenue = 0, nightsSold = 0, moneyNights = 0, due = 0, dueCount = 0;
  const parts = { room: 0, extraPerson: 0, extras: 0, discount: 0, tax: 0 }, byRoom = {}, bySource = {};
  stays.forEach((r) => {
    const m = stayMoney(r), [a, b] = repSpan(r, F, T), k = b - a + 1, share = k / m.n;
    for (let o = a; o <= b; o++) B.at(o).value += m.net / m.n;
    revenue += m.net * share;
    nightsSold += k;
    if (m.net > 0) moneyNights += k;
    const p = stayParts(r, m);
    parts.room += p.room * share; parts.extraPerson += p.extraPerson * share; parts.extras += p.extras * share; parts.discount += p.discount * share;
    parts.tax += m.tax * share;
    const room = byRoom[r.room] || (byRoom[r.room] = { revenue: 0, nights: 0 });
    room.revenue += m.net * share; room.nights += k;
    const src = REP_SOURCES.some(([v]) => v === r.source) ? r.source : r.source ? "other" : "direct";
    const s = bySource[src] || (bySource[src] = { count: 0, revenue: 0 });
    s.count++; s.revenue += m.net * share;
    if (balance(r) > 0) { due += balance(r); dueCount++; }
  });
  B.buckets.forEach((b) => { b.value = r2(b.value); });
  const units = Object.entries(byRoom).map(([code, v]) => ({ code, name: (roomByCode(code) || {}).name || "", revenue: r2(v.revenue), nights: v.nights }))
    .sort((a, b) => b.revenue - a.revenue || b.nights - a.nights);
  const total = rooms.length * span, available = Math.max(0, total - closed.size);
  Object.keys(parts).forEach((k) => { parts[k] = r2(parts[k]); });
  return {
    span, mode: B.mode, buckets: B.buckets, count: stays.length, requests, revenue: r2(revenue), nightsSold,
    totalRN: total, closedRN: closed.size, available, occupancy: available ? Math.min(1, nightsSold / available) : 0,
    adr: moneyNights ? r2(revenue / moneyNights) : 0, revpar: available ? r2(revenue / available) : 0,
    due: r2(due), dueCount, units, top: units.slice(0, 5), parts,
    sources: REP_SOURCES.filter(([v]) => bySource[v]).map(([v, label, color]) => ({ key: v, label, color, count: bySource[v].count, revenue: r2(bySource[v].revenue) }))
  };
}

/* Statistics count bookings by arrival (check-in in the period); room-night
   figures by the nights themselves. Calendar imports count as occupied
   nights only: they have no price, lead time or guest. */
function computeStats(data, F, T) {
  const rev = computeRevenue(data, F, T);
  const arrives = (r) => !repBlock(r) && r.inN >= F && r.inN <= T;
  const arrivals = data.res.filter((r) => repFirm(r) && arrives(r));
  const cancelled = data.res.filter((r) => r.status === "cancelled" && arrives(r));
  const nights = arrivals.reduce((s, r) => s + Math.max(1, r.outN - r.inN), 0);
  const leads = arrivals.filter((r) => r.bookedN != null && r.inN >= r.bookedN).map((r) => r.inN - r.bookedN);
  const value = (list) => list.reduce((s, r) => s + stayMoney(r).net, 0);
  const all = arrivals.length + cancelled.length;
  return {
    totalRN: rev.totalRN, closedRN: rev.closedRN, occupiedRN: rev.nightsSold,
    unoccupiedRN: Math.max(0, rev.totalRN - rev.closedRN - rev.nightsSold), occupancy: rev.occupancy,
    los: arrivals.length ? Math.round(nights / arrivals.length * 10) / 10 : 0,
    lead: leads.length ? Math.round(leads.reduce((s, v) => s + v, 0) / leads.length) : null,
    avgBooking: arrivals.length ? r2(value(arrivals) / arrivals.length) : 0,
    adr: rev.adr, revpar: rev.revpar, revenue: rev.revenue, bookings: arrivals.length,
    guests: arrivals.reduce((s, r) => s + (r.adults || 0) + (r.children || 0), 0),
    cancelled: cancelled.length, cancelledValue: r2(value(cancelled)), cancelRate: all ? cancelled.length / all : 0,
    requests: rev.requests
  };
}
const STAT_ROWS = [
  ["totalRN", "Total room nights", "Units × nights in the period", "n"],
  ["closedRN", "Closed room nights", "Closed in the Rate Calendar and not occupied", "n"],
  ["occupiedRN", "Occupied room nights", "Nights with a guest, including Airbnb/Vrbo calendar bookings", "n"],
  ["unoccupiedRN", "Unoccupied room nights", "Open to sell but not booked", "n"],
  ["occupancy", "Occupancy", "Occupied ÷ (total − closed)", "pct"],
  ["los", "Average length of stay", "Nights per booking arriving in the period", "nights"],
  ["lead", "Average lead time", "Days from booking to arrival", "days"],
  ["avgBooking", "Average revenue per booking", "Before tax, bookings arriving in the period", "money"],
  ["adr", "ADR (average daily rate)", "Revenue ÷ nights sold", "money"],
  ["revpar", "RevPAR", "Revenue ÷ room nights available", "money"],
  ["revenue", "Revenue", "Before tax, on the nights in the period", "money"],
  ["bookings", "Bookings arriving", "Confirmed, in-house or checked out", "n"],
  ["guests", "Guests arriving", "Adults and children", "n"],
  ["cancelled", "Cancelled reservations", "Bookings due to arrive in the period, cancelled", "n"],
  ["cancelledValue", "Cancelled booking value", "What they were worth before tax", "money"],
  ["cancelRate", "Cancellation rate", "Cancelled ÷ (arriving + cancelled)", "pct"]
];
function statFmt(v, kind) {
  if (v == null) return "—";
  if (kind === "pct") return repPct(v);
  if (kind === "money") return money(v);
  if (kind === "nights") return repPlural(v, "night", "nights");
  if (kind === "days") return repPlural(v, "day", "days");
  return String(v);
}

function computeOccupancy(data, F, T) {
  const span = T - F + 1, closed = repClosed(data, F, T);
  const occ = new Map(), rev = new Map(), byRoom = {};
  rooms.forEach((u) => { byRoom[u.code] = { code: u.code, name: u.name, nights: 0, closed: 0, revenue: 0, moneyNights: 0 }; });
  data.res.forEach((r) => {
    const s = repFirm(r) && repSpan(r, F, T);
    if (!s) return;
    const m = stayMoney(r), u = byRoom[r.room];
    for (let o = s[0]; o <= s[1]; o++) {
      occ.set(o, (occ.get(o) || 0) + 1);
      rev.set(o, (rev.get(o) || 0) + m.net / m.n);
      if (u) { u.nights++; u.revenue += m.net / m.n; if (m.net > 0) u.moneyNights++; }
    }
  });
  closed.forEach((k) => { const u = byRoom[k.split("|")[0]]; if (u) u.closed++; });
  const closedAt = new Map();
  closed.forEach((k) => { const o = +k.split("|")[1]; closedAt.set(o, (closedAt.get(o) || 0) + 1); });
  const night = (o) => ({ occupied: occ.get(o) || 0, closed: closedAt.get(o) || 0, revenue: rev.get(o) || 0 });
  const weeks = [];
  for (let w = F; w <= T; w += 7) {
    const end = Math.min(T, w + 6);
    const row = { from: addDays(w), to: addDays(end), nights: end - w + 1, occupied: 0, closed: 0, revenue: 0 };
    for (let o = w; o <= end; o++) { const n = night(o); row.occupied += n.occupied; row.closed += n.closed; row.revenue += n.revenue; }
    row.available = rooms.length * row.nights - row.closed;
    row.occupancy = row.available > 0 ? Math.min(1, row.occupied / row.available) : 0;
    row.adr = row.occupied ? r2(row.revenue / row.occupied) : 0;
    row.revenue = r2(row.revenue);
    weeks.push(row);
  }
  const dow = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, occupied: 0, available: 0 }));
  for (let o = F; o <= T; o++) {
    const d = dow[addDays(o).getDay()], n = night(o);
    d.occupied += n.occupied; d.available += rooms.length - n.closed;
  }
  dow.forEach((d) => { d.occupancy = d.available > 0 ? Math.min(1, d.occupied / d.available) : 0; });
  const units = Object.values(byRoom).map((u) => ({
    ...u, revenue: r2(u.revenue), available: span - u.closed,
    occupancy: span - u.closed > 0 ? Math.min(1, u.nights / (span - u.closed)) : 0,
    adr: u.moneyNights ? r2(u.revenue / u.moneyNights) : 0
  })).sort((a, b) => b.occupancy - a.occupancy || b.revenue - a.revenue);
  const occupied = weeks.reduce((s, w) => s + w.occupied, 0), available = weeks.reduce((s, w) => s + w.available, 0);
  return { span, weeks, dow, units, occupied, available, closed: closed.size, occupancy: available ? Math.min(1, occupied / available) : 0 };
}

/* One row per guest: the same email, else phone, else name. */
function computeGuests(data, F, T) {
  const stays = data.res.filter((r) => repFirm(r) && !repBlock(r) && r.inN >= F && r.inN <= T);
  const groups = new Map();
  stays.forEach((r) => {
    const email = String(r.email || (/@/.test(r.contact || "") ? r.contact : "")).trim().toLowerCase();
    const phone = String(r.phone || (r.contact && !/@|—/.test(r.contact) ? r.contact : "")).replace(/\D/g, "");
    const key = email || (phone.length >= 7 ? "tel:" + phone : "name:" + String(r.guest || "").trim().toLowerCase());
    const g = groups.get(key) || { name: r.guest, email, phone: r.phone || (phone ? r.contact : ""), stays: 0, nights: 0, revenue: 0, spent: 0, paid: 0, last: -Infinity, first: Infinity };
    const m = stayMoney(r);
    g.stays++; g.nights += m.n; g.revenue += m.net; g.spent += r.total; g.paid += r.paid;
    if (r.outN > g.last) { g.last = r.outN; g.name = r.guest; }
    g.first = Math.min(g.first, r.inN);
    groups.set(key, g);
  });
  const guests = [...groups.values()].map((g) => ({ ...g, revenue: r2(g.revenue), spent: r2(g.spent), paid: r2(g.paid) }))
    .sort((a, b) => b.revenue - a.revenue || b.nights - a.nights);
  const repeat = guests.filter((g) => g.stays > 1).length;
  return {
    guests, repeat, stays: stays.length,
    nights: guests.reduce((s, g) => s + g.nights, 0), revenue: r2(guests.reduce((s, g) => s + g.revenue, 0))
  };
}

/* Extras sold with stays arriving in the period, from each booking's add-on
   lines (as priced when booked), plus extra-person fees. */
function computeExtras(data, F, T) {
  const stays = data.res.filter((r) => repFirm(r) && !repBlock(r) && r.inN >= F && r.inN <= T);
  const ids = new Set(stays.map((r) => r.id || r.ref));
  const byName = new Map();
  data.addons.forEach((a) => {
    if (!ids.has(a.resId)) return;
    const x = byName.get(a.name) || { name: a.name, bookings: new Set(), qty: 0, revenue: 0 };
    x.bookings.add(a.resId); x.qty += a.qty || 1; x.revenue += a.amount;
    byName.set(a.name, x);
  });
  const rows = [...byName.values()].map((x) => ({ name: x.name, bookings: x.bookings.size, qty: x.qty, revenue: r2(x.revenue),
    attach: stays.length ? x.bookings.size / stays.length : 0, avg: x.bookings.size ? r2(x.revenue / x.bookings.size) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const withExtras = new Set(data.addons.filter((a) => ids.has(a.resId)).map((a) => a.resId)).size;
  const extraPerson = r2(stays.reduce((s, r) => s + (r.extraPerson || 0), 0));
  return { rows, stays: stays.length, withExtras, revenue: r2(rows.reduce((s, x) => s + x.revenue, 0)), extraPerson };
}

/* Tax on the nights in the period, by calendar month and by rule. */
function computeTax(data, F, T) {
  const months = new Map(), names = [];
  const month = (o) => {
    const d = addDays(o), key = d.getFullYear() * 12 + d.getMonth();
    if (!months.has(key)) months.set(key, { label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }), from: o, to: o, taxable: 0, tax: 0, paid: 0, rules: {} });
    const row = months.get(key); row.to = o;
    return row;
  };
  for (let o = F; o <= T; o++) month(o);
  data.res.forEach((r) => {
    const s = repFirm(r) && repSpan(r, F, T);
    if (!s) return;
    const m = stayMoney(r), split = taxSplit(r, m), ps = paidShare(r);
    split.forEach(([n]) => { if (!names.includes(n)) names.push(n); });
    for (let o = s[0]; o <= s[1]; o++) {
      const row = month(o);
      row.taxable += m.net / m.n; row.tax += m.tax / m.n; row.paid += m.tax / m.n * ps;
      split.forEach(([n, v]) => { row.rules[n] = (row.rules[n] || 0) + v / m.n; });
    }
  });
  const order = taxes.filter((t) => t.on).map((t) => t.name).filter((n) => names.includes(n)).concat(names.filter((n) => !taxes.some((t) => t.on && t.name === n)));
  const rows = [...months.values()].map((row) => ({ ...row, taxable: r2(row.taxable), tax: r2(row.tax), paid: r2(row.paid),
    rules: Object.fromEntries(order.map((n) => [n, r2(row.rules[n] || 0)])) }));
  const sum = (k) => r2(rows.reduce((s, row) => s + row[k], 0));
  return { rows, names: order, taxable: sum("taxable"), tax: sum("tax"), paid: sum("paid"),
    rules: Object.fromEntries(order.map((n) => [n, r2(rows.reduce((s, row) => s + row.rules[n], 0))])) };
}

/* Accounting: sales by account for bookings arriving in the period (one
   invoice per booking, dated its check-in), and money received or refunded
   on dates in the period. */
const REP_METHOD = (m) => ({ card: "Card", cash: "Cash", "bank transfer": "Bank transfer", check: "Check", other: "Other" }[String(m || "").toLowerCase()] || (m ? String(m) : "Other"));
function computeAccounting(data, F, T) {
  const stays = data.res.filter((r) => repFirm(r) && !repBlock(r) && r.inN >= F && r.inN <= T);
  const lines = new Map(data.addons.map((a) => [a.resId, []]));
  data.addons.forEach((a) => lines.get(a.resId).push(a));
  const sales = { room: 0, extraPerson: 0, extras: 0, discount: 0, taxes: {}, total: 0 };
  const invoices = stays.map((r) => {
    const m = stayMoney(r), p = stayParts(r, m), extraLines = lines.get(r.id || r.ref) || [];
    const listedTotal = extraLines.reduce((s, a) => s + a.amount, 0);
    if (r.subtotal == null && listedTotal) { p.room = Math.max(0, p.room - listedTotal); p.extras = listedTotal; } // demo: total only
    const items = [{ item: "Lodging", desc: `${r.room} · ${repPlural(m.n, "night", "nights")}`, qty: m.n, rate: r2(p.room / m.n), amount: r2(p.room) }];
    if (p.extraPerson) items.push({ item: "Extra person fees", desc: "Extra guests", qty: 1, rate: r2(p.extraPerson), amount: r2(p.extraPerson) });
    const listed = extraLines.reduce((s, a) => s + a.amount, 0);
    extraLines.forEach((a) => items.push({ item: "Extras", desc: a.name, qty: a.qty || 1, rate: r2(a.amount / (a.qty || 1)), amount: r2(a.amount) }));
    if (p.extras - listed > 0.004) items.push({ item: "Extras", desc: "Extras", qty: 1, rate: r2(p.extras - listed), amount: r2(p.extras - listed) });
    if (p.discount) items.push({ item: "Discounts", desc: "Discount", qty: 1, rate: -r2(p.discount), amount: -r2(p.discount) });
    taxSplit(r, m).forEach(([n, v]) => { items.push({ item: n, desc: "Tax", qty: 1, rate: r2(v), amount: r2(v) }); sales.taxes[n] = (sales.taxes[n] || 0) + v; });
    sales.room += p.room; sales.extraPerson += p.extraPerson; sales.extras += p.extras; sales.discount += p.discount; sales.total += r.total;
    return { r, date: repIso(r.inN), due: repIso(r.outN), items };
  });
  ["room", "extraPerson", "extras", "discount", "total"].forEach((k) => { sales[k] = r2(sales[k]); });
  Object.keys(sales.taxes).forEach((k) => { sales.taxes[k] = r2(sales.taxes[k]); });
  const lo = repIso(F), hi = repIso(T);
  const payments = data.txns.filter((t) => t.date >= lo && t.date <= hi).sort((a, b) => String(a.at || a.date).localeCompare(String(b.at || b.date)));
  const methods = new Map();
  payments.forEach((t) => {
    const k = REP_METHOD(t.method), x = methods.get(k) || { method: k, count: 0, received: 0, refunded: 0, fees: 0 };
    if (t.amount >= 0) { x.count++; x.received += t.amount; } else x.refunded += -t.amount;
    x.fees += t.fee || 0;
    methods.set(k, x);
  });
  const byMethod = [...methods.values()].map((x) => ({ ...x, received: r2(x.received), refunded: r2(x.refunded), fees: r2(x.fees), net: r2(x.received - x.refunded) }));
  return {
    invoices, sales, payments, byMethod,
    received: r2(byMethod.reduce((s, x) => s + x.received, 0)), refunded: r2(byMethod.reduce((s, x) => s + x.refunded, 0)),
    fees: r2(byMethod.reduce((s, x) => s + x.fees, 0))
  };
}

/* Everything still owed, as of now: the loaded bookings include every stay
   with a balance (js/db.js loads those whatever their dates). Requests and
   calendar imports aren't owed yet. */
function computeBalances() {
  const open = reservations.filter((r) => r.status !== "cancelled" && r.status !== "pending" && !repBlock(r) && balance(r) > 0.004);
  const group = (r) => r.status === "checked-out" || r.outN < 0 ? "overdue"
    : r.status === "checked-in" || r.inN <= 0 ? "inhouse" : r.inN <= 7 ? "soon" : "later";
  const groups = [["overdue", "Stay over, still owing"], ["inhouse", "In-house now"], ["soon", "Arriving in the next 7 days"], ["later", "Arriving later"]]
    .map(([key, label]) => {
      const list = open.filter((r) => group(r) === key).sort((a, b) => a.inN - b.inN);
      return { key, label, list, due: r2(list.reduce((s, r) => s + balance(r), 0)) };
    });
  return { groups, total: r2(open.reduce((s, r) => s + balance(r), 0)), count: open.length };
}

function computeDaily(data, D) {
  const live = (r) => r.status !== "cancelled" && !(r.status === "pending" && r.awaitingCard);
  const byRoom = (a, b) => String(a.room).localeCompare(String(b.room));
  return {
    arrivals: data.res.filter((r) => live(r) && r.inN === D).sort(byRoom),
    departures: data.res.filter((r) => live(r) && r.outN === D).sort(byRoom),
    staying: data.res.filter((r) => live(r) && r.inN < D && r.outN > D).sort(byRoom)
  };
}

/* ---------------------------------------------------------------- data */
/* Demo add-on lines and payments, made up from the sample bookings. */
const DEMO_EXTRAS = {
  "R-1042": [["Firewood bundle", 18], ["Breakfast basket", 64, 2]], "R-1044": [["Hot tub soak kit", 25], ["Firewood bundle", 18], ["Late checkout (1 PM)", 45]],
  "R-1045": [["Breakfast basket", 128, 4]], "R-1046": [["Pet fee", 60]], "R-1047": [["Firewood bundle", 18], ["Hot tub soak kit", 25]],
  "R-1050": [["Breakfast basket", 64, 2]], "R-1052": [["Pet fee", 60], ["Firewood bundle", 18]]
};
function demoData() {
  const addonLines = [];
  Object.entries(DEMO_EXTRAS).forEach(([ref, list]) => list.forEach(([name, amount, qty]) => addonLines.push({ resId: ref, name, amount, qty: qty || 1 })));
  const methods = ["card", "Cash", "card", "Bank transfer"];
  const txns = reservations.filter((r) => r.paid > 0).map((r, i) => {
    const off = r.inN <= 0 ? r.inN : (r.bookedN != null ? r.bookedN : -1);
    return { date: repIso(off), at: repIso(off), resId: r.ref, ref: r.ref, guest: r.guest, desc: `${r.ref} · Payment`, method: methods[i % 4], kind: "charge", amount: r.paid, fee: 0 };
  });
  const closures = Object.entries(rateOverrides).filter(([, v]) => v && v.closed).map(([k]) => ({ typeId: k.split("|")[0], date: k.split("|")[1] }));
  return { res: reservations, addons: addonLines, txns, closures };
}
const repLive = () => !!(window.SHDB && SHDB.hasLive());
/* Bookings overlapping [from, to] with whatever else the report needs. The
   loaded bookings cover everything checking out on or after the history
   cutoff, so only older periods (and "All time") are fetched. */
async function repLoad(from, to, need) {
  if (!repLive()) return demoData();
  const covered = from >= SHDB.historyStart();
  const res = covered ? reservations : await SHDB.reportReservations(from, to);
  const ids = need.addons ? res.filter((r) => r.id && repSpan(r, repOff(from), repOff(to))).map((r) => r.id) : [];
  const [addonLines, txns, closures] = await Promise.all([
    need.addons ? SHDB.reportAddons(ids) : [],
    need.txns ? SHDB.reportTransactions(from, to) : [],
    need.closures ? SHDB.reportClosures(from, to) : []
  ]);
  return { res, addons: addonLines, txns, closures };
}
const REP_NEEDS = {
  revenue: { closures: true }, statistics: { closures: true }, occupancy: { closures: true },
  guests: {}, extras: { addons: true }, tax: {}, accounting: { addons: true, txns: true }, balances: {}, daily: {}
};

/* ---------------------------------------------------------------- rendering */
const repCard = (title, hint, inner, extra = "") => `<div class="card card-pad"${extra}><h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ""}${inner}</div>`;
const repKpis = (list) => `<div class="grid g-kpi">${list.map(([label, value, sub], i) => `<div class="card kpi${i === 0 ? " accent" : ""}"><div class="k-label">${esc(label)}</div><div class="k-value">${value}</div><div class="k-sub">${esc(sub || "")}</div></div>`).join("")}</div>`;
/* cols: [label, align("num"|"")], rows: arrays of cell HTML. */
const repTable = (cols, rows, foot, wide) => `<div class="table-wrap"><table class="data rep-table${wide ? " rep-wide" : ""}"><thead><tr>${cols.map(([l, c]) => `<th${c ? ` class="${c}"` : ""}>${l}</th>`).join("")}</tr></thead><tbody>${
  rows.length ? rows.map((row) => `<tr>${row.map((v, i) => `<td${cols[i][1] ? ` class="${cols[i][1]}"` : ""}>${v}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}"><div class="empty">Nothing in this period.</div></td></tr>`
}</tbody>${foot ? `<tfoot><tr>${foot.map((v, i) => `<td${cols[i][1] ? ` class="${cols[i][1]}"` : ""}>${v}</td>`).join("")}</tr></tfoot>` : ""}</table></div>`;
const repMeter = (v) => `<span class="rep-meter"><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></span>${repPct(v)}`;
const repDate = (off) => dstr(addDays(off));

function repRevenueHTML(rev) {
  const max = Math.max(1, ...rev.buckets.map((d) => d.value));
  const chart = rev.revenue > 0
    ? rev.buckets.map((d) => `<div class="bar" title="${esc(d.title)} · ${money(d.value)}"><i style="height:${Math.max(2, Math.round(d.value / max * 100))}%"></i><span>${esc(d.label)}</span></div>`).join("")
    : `<div class="empty">No revenue in this period.</div>`;
  const total = rev.sources.reduce((s, g) => s + g.count, 0), C = 2 * Math.PI * 58;
  let acc = 0;
  const arcs = rev.sources.map((g) => {
    const frac = g.count / Math.max(1, total);
    const s = `<circle cx="75" cy="75" r="58" fill="none" stroke="${g.color}" stroke-width="20" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-acc * C).toFixed(1)}" transform="rotate(-90 75 75)"/>`;
    acc += frac; return s;
  }).join("");
  const donut = total ? `<div class="donut-row">
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="${esc(rev.sources.map((g) => `${g.label} ${g.count}`).join(", "))}"><circle cx="75" cy="75" r="58" fill="none" stroke="#e8eeec" stroke-width="20"/>${arcs}<text x="75" y="71" text-anchor="middle" font-family="Sora,sans-serif" font-weight="700" font-size="22" fill="#101f1e">${total}</text><text x="75" y="89" text-anchor="middle" font-size="11" fill="#5d6f6b">${total === 1 ? "stay" : "stays"}</text></svg>
      <div class="legend" style="flex:1">${rev.sources.map((g) => `<div><i style="background:${g.color}"></i>${esc(g.label)} · ${g.count}<b>${money(g.revenue)}</b></div>`).join("")}</div>
    </div>` : `<div class="empty">No stays in this period.</div>`;
  const tmax = rev.top.length ? Math.max(1, rev.top[0].revenue) : 1;
  const top = rev.top.map((u) => `
    <div class="row-item"><div class="ri-main" style="flex:1"><strong>${esc(u.code)}${u.name ? " · " + esc(u.name) : ""}</strong>
      <span>${repPlural(u.nights, "night", "nights")} · ${Math.round(u.nights / rev.span * 100)}% occupied</span>
      <div class="progress" style="background:var(--surface-3);margin-top:6px"><i style="width:${Math.round(u.revenue / tmax * 100)}%;background:var(--brand-2)"></i></div></div>
      <div class="ri-right mono">${money(u.revenue)}</div></div>`).join("") || `<div class="empty">No stays in this period.</div>`;
  const p = rev.parts;
  const breakdown = `<dl class="kv">
      <dt>Room</dt><dd class="mono">${money(p.room)}</dd>
      <dt>Extra-person fees</dt><dd class="mono">${money(p.extraPerson)}</dd>
      <dt>Extras</dt><dd class="mono">${money(p.extras)}</dd>
      <dt>Discounts</dt><dd class="mono">${p.discount ? "−" + money(p.discount) : money(0)}</dd>
      <dt><strong>Revenue before tax</strong></dt><dd class="mono"><strong>${money(rev.revenue)}</strong></dd>
      <dt>Tax</dt><dd class="mono">${money(p.tax)}</dd>
      <dt>Total charged</dt><dd class="mono">${money(r2(rev.revenue + p.tax))}</dd></dl>`;
  return repKpis([
    ["Revenue", money(rev.revenue), repState.preset === "next30" ? "On the books, before tax" : "Before tax"],
    ["Occupancy", `${Math.round(rev.occupancy * 100)}<small>%</small>`, `${rev.nightsSold} of ${repPlural(rev.available, "room-night", "room-nights")}`],
    ["Average nightly rate", money(rev.adr), `RevPAR ${money(rev.revpar)}`],
    ["Balance due", money(rev.due), rev.dueCount ? `Owed on ${repPlural(rev.dueCount, "stay", "stays")}` : "Every stay is paid"]
  ]) + `<div class="grid g-2eq mt">
    ${repCard(rev.mode === "night" ? "Revenue by night" : rev.mode === "week" ? "Revenue by week" : "Revenue by month", "Earned on the nights guests stay, before tax", `<div class="bar-chart" id="revChart">${chart}</div>`)}
    ${repCard("Where bookings come from", "Stays in this period by booking source", donut)}
  </div><div class="grid g-2eq mt">
    ${repCard("Top performing units", "Revenue and nights sold in this period", `<div class="row-list">${top}</div>`)}
    ${repCard("Revenue breakdown", "What the nights in this period were charged", breakdown)}
  </div>`;
}

function repStatsHTML(cur, prev) {
  const better = { closedRN: -1, unoccupiedRN: -1, cancelled: -1, cancelledValue: -1, cancelRate: -1 };
  const change = (k, kind) => {
    if (!prev || cur[k] == null || prev[k] == null) return "—";
    const d = cur[k] - prev[k];
    if (Math.abs(d) < 1e-9) return `<span class="rep-flat">No change</span>`;
    const good = d * (better[k] || 1) > 0;
    const txt = kind === "pct" ? `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d * 1000) / 10)} pts`
      : kind === "money" ? `${d > 0 ? "+" : "−"}${money(Math.abs(d))}` : `${d > 0 ? "+" : "−"}${Math.round(Math.abs(d) * 10) / 10}`;
    return `<span class="${good ? "rep-up" : "rep-down"}">${txt}</span>`;
  };
  return repKpis([
    ["Occupancy", repPct(cur.occupancy), `${cur.occupiedRN} of ${cur.totalRN - cur.closedRN} room-nights`],
    ["ADR", money(cur.adr), "Revenue ÷ nights sold"],
    ["RevPAR", money(cur.revpar), "Revenue ÷ room-nights available"],
    ["Cancelled", String(cur.cancelled), cur.cancelled ? `${repPct(cur.cancelRate)} of bookings · ${money(cur.cancelledValue)}` : "None in this period"]
  ]) + `<div class="mt">${repTable([["Statistic", ""], ["This period", "num"]].concat(prev ? [["Previous period", "num"], ["Change", "num"]] : []),
    STAT_ROWS.map(([k, label, hint, kind]) => [`<strong>${esc(label)}</strong><small class="rep-hint">${esc(hint)}</small>`, statFmt(cur[k], kind)].concat(prev ? [statFmt(prev[k], kind), change(k, kind)] : [])))}</div>` +
    (cur.requests ? `<p class="hint mt">${repPlural(cur.requests, "request", "requests")} awaiting confirmation in this period ${cur.requests === 1 ? "isn't" : "aren't"} counted.</p>` : "");
}

function repOccupancyHTML(o) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return repKpis([
    ["Occupancy", repPct(o.occupancy), `${o.occupied} of ${repPlural(o.available, "room-night", "room-nights")} available`],
    ["Occupied room-nights", String(o.occupied), `Over ${repPlural(o.span, "night", "nights")}`],
    ["Closed room-nights", String(o.closed), "Closed in the Rate Calendar"],
    ["Units", String(rooms.length), "Rooms and cabins"]
  ]) + `<div class="section-title"><h2>By week</h2><div class="line"></div></div>` +
    repTable([["Week", ""], ["Available", "num"], ["Closed", "num"], ["Occupied", "num"], ["Occupancy", ""], ["ADR", "num"], ["Revenue", "num"]],
      o.weeks.map((w) => [`${dstr(w.from)} – ${dstr(w.to)}${w.nights < 7 ? ` <small class="rep-hint">${repPlural(w.nights, "night", "nights")}</small>` : ""}`, w.available, w.closed, w.occupied, repMeter(w.occupancy), money(w.adr), money(w.revenue)]), null, true) +
    `<div class="grid g-2eq mt"><div>${`<div class="section-title" style="margin-top:0"><h2>By day of the week</h2><div class="line"></div></div>`}${
      repTable([["Night", ""], ["Occupied", "num"], ["Occupancy", ""]], [1, 2, 3, 4, 5, 6, 0].map((d) => [days[d], o.dow[d].occupied, repMeter(o.dow[d].occupancy)]))}</div>
      <div><div class="section-title" style="margin-top:0"><h2>By unit</h2><div class="line"></div></div>${
      repTable([["Unit", ""], ["Nights", "num"], ["Occupancy", ""], ["ADR", "num"], ["Revenue", "num"]], o.units.map((u) => [`${esc(u.code)}${u.name ? ` <small class="rep-hint">${esc(u.name)}</small>` : ""}`, u.nights, repMeter(u.occupancy), money(u.adr), money(u.revenue)]))}</div></div>`;
}

function repGuestsHTML(g) {
  const q = repState.query.trim().toLowerCase();
  const list = q ? g.guests.filter((x) => (x.name + " " + x.email + " " + x.phone).toLowerCase().includes(q)) : g.guests;
  const shown = list.slice(0, 300);
  return repKpis([
    ["Guests", String(g.guests.length), `${repPlural(g.stays, "stay", "stays")} arriving in the period`],
    ["Repeat guests", String(g.repeat), g.guests.length ? `${repPct(g.repeat / g.guests.length)} stayed more than once` : "—"],
    ["Nights per guest", g.guests.length ? String(Math.round(g.nights / g.guests.length * 10) / 10) : "0", `${g.nights} nights in all`],
    ["Revenue per guest", money(g.guests.length ? r2(g.revenue / g.guests.length) : 0), "Before tax"]
  ]) + `<div class="rep-tools mt"><input class="input" type="search" id="repGuestSearch" placeholder="Find a guest by name, email or phone" value="${esc(repState.query)}" aria-label="Find a guest"></div>` +
    repTable([["Guest", ""], ["Stays", "num"], ["Nights", "num"], ["Revenue", "num"], ["Total charged", "num"], ["Last stay", ""]],
      shown.map((x) => [`<span class="guest"><strong>${esc(x.name)}</strong><span>${esc(x.email || x.phone || "No contact details")}</span></span>${x.stays > 1 ? ' <span class="tag">Repeat</span>' : ""}`,
        x.stays, x.nights, money(x.revenue), money(x.spent), `${repDate(x.first)}${x.stays > 1 || x.last - x.first > 0 ? ` → ${repDate(x.last)}` : ""}`]), null, true) +
    (list.length > shown.length ? `<p class="hint mt">Showing the top ${shown.length} of ${list.length}. Export CSV has everyone.</p>` : "");
}

function repExtrasHTML(x) {
  const top = x.rows[0];
  return repKpis([
    ["Extras revenue", money(x.revenue), "Before tax"],
    ["Bookings with extras", x.stays ? repPct(x.withExtras / x.stays) : "0%", `${x.withExtras} of ${repPlural(x.stays, "booking", "bookings")}`],
    ["Most popular", top ? esc(top.name) : "—", top ? `${repPlural(top.bookings, "booking", "bookings")} · ${money(top.revenue)}` : "No extras sold"],
    ["Extra-person fees", money(x.extraPerson), "Charged for extra guests"]
  ]) + `<div class="mt">${repTable([["Extra", ""], ["Bookings", "num"], ["Quantity", "num"], ["Taken by", ""], ["Per booking", "num"], ["Revenue", "num"]],
    x.rows.map((e) => [`<strong>${esc(e.name)}</strong>`, e.bookings, e.qty, repMeter(e.attach), money(e.avg), money(e.revenue)]),
    x.rows.length ? ["<strong>Total</strong>", "", "", "", "", `<strong>${money(x.revenue)}</strong>`] : null)}</div>`;
}

function repTaxHTML(t) {
  const cols = [["Month", ""], ["Taxable revenue", "num"]].concat(t.names.map((n) => [esc(n), "num"]), [["Total tax", "num"], ["Paid by guests", "num"], ["Still to collect", "num"]]);
  return repKpis([
    ["Tax on these nights", money(t.tax), "Charged to guests"],
    ["Paid by guests so far", money(t.paid), t.tax ? repPct(t.paid / t.tax) + " of it" : "—"],
    ["Still to collect", money(r2(t.tax - t.paid)), "On unpaid balances"],
    ["Taxable revenue", money(t.taxable), "Before tax"]
  ]) + `<div class="mt">${repTable(cols,
    t.rows.map((row) => [esc(row.label), money(row.taxable)].concat(t.names.map((n) => money(row.rules[n])), [money(row.tax), money(row.paid), money(r2(row.tax - row.paid))])),
    ["<strong>Total</strong>", `<strong>${money(t.taxable)}</strong>`].concat(t.names.map((n) => `<strong>${money(t.rules[n])}</strong>`), [`<strong>${money(t.tax)}</strong>`, `<strong>${money(t.paid)}</strong>`, `<strong>${money(r2(t.tax - t.paid))}</strong>`]), true)}</div>
    <p class="hint mt">Tax is counted on the night it was earned. Each booking's tax is what it was charged; the split between rules follows your tax rules as they are now.</p>`;
}

function repAccountingHTML(a) {
  const s = a.sales, taxNames = Object.keys(s.taxes);
  const salesRows = [["Lodging", s.room], ["Extra person fees", s.extraPerson], ["Extras", s.extras], ["Discounts", -s.discount]]
    .concat(taxNames.map((n) => [n + " (tax)", s.taxes[n]]));
  return repKpis([
    ["Invoiced", money(s.total), `${repPlural(a.invoices.length, "booking", "bookings")} arriving in the period`],
    ["Received", money(a.received), `${repPlural(a.payments.filter((t) => t.amount >= 0).length, "payment", "payments")}`],
    ["Refunded", money(a.refunded), "Returned to guests"],
    ["Guest card fees", money(a.fees), "Paid by guests on top"]
  ]) + `<div class="grid g-2eq mt">
    ${repCard("Sales by account", "Bookings arriving in the period, one invoice each, dated their check-in", repTable([["Account", ""], ["Amount", "num"]], salesRows.map(([n, v]) => [esc(n), (v < 0 ? "−" : "") + money(Math.abs(v))]), ["<strong>Total</strong>", `<strong>${money(s.total)}</strong>`]))}
    ${repCard("Payments by method", "Money received or refunded on dates in the period", repTable([["Method", ""], ["Payments", "num"], ["Received", "num"], ["Refunded", "num"], ["Net", "num"]], a.byMethod.map((x) => [esc(x.method), x.count, money(x.received), money(x.refunded), money(x.net)]), a.byMethod.length ? ["<strong>Total</strong>", "", `<strong>${money(a.received)}</strong>`, `<strong>${money(a.refunded)}</strong>`, `<strong>${money(r2(a.received - a.refunded))}</strong>`] : null))}
  </div>
  <div class="card card-pad mt rep-export">
    <h3>Export for QuickBooks</h3>
    <p class="hint">Two CSV files: invoices (one per booking, with lodging, extras, discounts and each tax as lines) and payments (received and refunded). In QuickBooks Online, import invoices under Settings → Import data → Invoices, and payments through Banking → Upload transactions, or hand both to your bookkeeper. Dates are MM/DD/YYYY.</p>
    <div class="rep-export-btns"><button class="btn btn-primary btn-sm" type="button" data-rep-export="invoices">Download invoices (${a.invoices.length})</button>
    <button class="btn btn-ghost btn-sm" type="button" data-rep-export="payments">Download payments (${a.payments.length})</button></div>
  </div>
  <div class="section-title"><h2>Payments</h2><div class="line"></div></div>` +
    repTable([["Date", ""], ["Booking", ""], ["Guest", ""], ["Method", ""], ["Type", ""], ["Amount", "num"]],
      a.payments.slice(-200).reverse().map((t) => [esc(dstr(new Date(t.date + "T12:00:00"))), esc(t.ref || "—"), esc(t.guest || ""), esc(REP_METHOD(t.method)), t.amount < 0 ? "Refund" : "Payment", `${t.amount < 0 ? "−" : ""}${money(Math.abs(t.amount))}`]), null, true) +
    (a.payments.length > 200 ? `<p class="hint mt">Showing the latest 200 of ${a.payments.length}. The payments download has them all.</p>` : "");
}

function repBalancesHTML(b) {
  const by = Object.fromEntries(b.groups.map((g) => [g.key, g]));
  return repKpis([
    ["Total due", money(b.total), repPlural(b.count, "booking", "bookings")],
    ["Stay over", money(by.overdue.due), repPlural(by.overdue.list.length, "booking", "bookings")],
    ["In-house", money(by.inhouse.due), repPlural(by.inhouse.list.length, "booking", "bookings")],
    ["Arriving", money(r2(by.soon.due + by.later.due)), `${by.soon.list.length} within 7 days`]
  ]) + b.groups.filter((g) => g.list.length).map((g) => `<div class="section-title"><h2>${esc(g.label)} · ${money(g.due)}</h2><div class="line"></div></div>` +
    repTable([["Guest", ""], ["Booking", ""], ["Room", ""], ["Dates", ""], ["Status", ""], ["Total", "num"], ["Paid", "num"], ["Due", "num"], ["", "num"]],
      g.list.map((r) => [`<span class="guest"><strong>${esc(r.guest)}</strong><span>${esc(r.contact || "")}</span></span>`, `<span class="mono">${esc(r.ref)}</span>`, `<span class="room-code">${esc(r.room)}</span>`,
        esc(resDates(r)), statusPill(r), money(r.total), money(r.paid), `<b style="color:var(--danger)">${money(balance(r))}</b>`,
        `<button class="btn btn-ghost btn-xs" data-action="charge" data-ref="${esc(r.ref)}" type="button">Take payment</button>`]), null, true)).join("") +
    (b.count ? "" : `<div class="card card-pad mt"><div class="empty">Nothing is owed. Every booking is paid.</div></div>`);
}

function repDailyHTML(d, D) {
  const today = D === 0;
  const party = (r) => [r.adults ? repPlural(r.adults, "adult", "adults") : "", r.children ? repPlural(r.children, "child", "children") : ""].filter(Boolean).join(", ") || "—";
  const step = (r) => (today && reservations.includes(r) ? stepButton(r) : "");
  const table = (list, kind) => repTable([["Room", ""], ["Guest", ""], ["Stay", ""], ["Guests", ""], [kind === "arr" ? "Arrival time" : "Status", ""], ["Due", "num"], ["", "num"]],
    list.map((r) => [`<span class="room-code">${esc(r.room)}</span>`, `<span class="guest"><strong>${esc(r.guest)}</strong><span>${esc(r.contact || "")}</span></span>`,
      `${esc(resDates(r))} <small class="rep-hint">${repPlural(Math.max(1, r.outN - r.inN), "night", "nights")}</small>`, party(r),
      kind === "arr" ? `${statusPill(r)} ${esc(r.arrival || "")}` : statusPill(r),
      balance(r) > 0 ? `<b style="color:var(--danger)">${money(balance(r))}</b>` : money(0), step(r)]), null, true);
  return repKpis([
    ["Arrivals", String(d.arrivals.length), d.arrivals.filter((r) => r.status === "checked-in").length + " checked in"],
    ["Departures", String(d.departures.length), d.departures.filter((r) => r.status === "checked-out").length + " checked out"],
    ["Staying over", String(d.staying.length), "In-house all day"],
    ["Rooms to turn", String(new Set(d.departures.map((r) => r.room)).size), "Departures to clean"]
  ]) + `<div class="section-title"><h2>Arrivals</h2><div class="line"></div></div>${table(d.arrivals, "arr")}
    <div class="section-title"><h2>Departures</h2><div class="line"></div></div>${table(d.departures, "dep")}
    <div class="section-title"><h2>Staying over</h2><div class="line"></div></div>${table(d.staying, "stay")}`;
}

/* ---------------------------------------------------------------- export */
const qbDate = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${m}/${d}/${y}`; };
const repName = (r) => String(r.guest || "Guest").trim() || "Guest";
function repExportRows(key, out) {
  const head = [["Report", (REPORTS.find((x) => x.key === key) || {}).label || key], ["From", repState.from], ["To", repState.to], ["Currency", moneyCurrency], ["", ""]];
  if (key === "revenue") {
    const v = out;
    return head.concat([["Stays", v.count], ["Requests awaiting confirmation (not counted)", v.requests], ["Revenue before tax", v.revenue.toFixed(2)],
      ["Room-nights sold", v.nightsSold], ["Room-nights available", v.available], ["Occupancy %", (v.occupancy * 100).toFixed(1)], ["ADR", v.adr.toFixed(2)], ["RevPAR", v.revpar.toFixed(2)],
      ["Balance due on these stays", v.due.toFixed(2)], ["", ""], ["Room", v.parts.room.toFixed(2)], ["Extra-person fees", v.parts.extraPerson.toFixed(2)], ["Extras", v.parts.extras.toFixed(2)],
      ["Discounts", (-v.parts.discount).toFixed(2)], ["Tax", v.parts.tax.toFixed(2)], ["", ""], ["Source", "Stays", "Revenue before tax"]],
      v.sources.map((g) => [g.label, g.count, g.revenue.toFixed(2)]), [["", ""], ["Unit", "Nights", "Revenue before tax"]],
      v.units.map((u) => [u.code + (u.name ? " · " + u.name : ""), u.nights, u.revenue.toFixed(2)]),
      [["", ""], [v.mode === "night" ? "Night" : v.mode === "week" ? "Week of" : "Month", "Revenue before tax"]], v.buckets.map((b) => [b.iso, b.value.toFixed(2)]));
  }
  if (key === "statistics") {
    const raw = (v, kind) => (v == null ? "" : kind === "pct" ? (v * 100).toFixed(1) + "%" : kind === "money" ? v.toFixed(2) : v);
    return head.concat([["Statistic", "This period", out.prev ? "Previous period" : ""]], STAT_ROWS.map(([k, label, , kind]) => [label, raw(out.cur[k], kind), out.prev ? raw(out.prev[k], kind) : ""]));
  }
  if (key === "occupancy") {
    return head.concat([["Week from", "Week to", "Available", "Closed", "Occupied", "Occupancy %", "ADR", "Revenue"]],
      out.weeks.map((w) => [isoLocal(w.from), isoLocal(w.to), w.available, w.closed, w.occupied, (w.occupancy * 100).toFixed(1), w.adr.toFixed(2), w.revenue.toFixed(2)]),
      [["", ""], ["Unit", "Nights", "Closed", "Occupancy %", "ADR", "Revenue"]], out.units.map((u) => [u.code + (u.name ? " · " + u.name : ""), u.nights, u.closed, (u.occupancy * 100).toFixed(1), u.adr.toFixed(2), u.revenue.toFixed(2)]),
      [["", ""], ["Night of week", "Occupied", "Occupancy %"]], [1, 2, 3, 4, 5, 6, 0].map((d) => [["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d], out.dow[d].occupied, (out.dow[d].occupancy * 100).toFixed(1)]));
  }
  if (key === "guests") {
    return head.concat([["Guest", "Email", "Phone", "Stays", "Nights", "Revenue before tax", "Total charged", "Paid", "First arrival", "Last check-out"]],
      out.guests.map((g) => [g.name, g.email, g.phone, g.stays, g.nights, g.revenue.toFixed(2), g.spent.toFixed(2), g.paid.toFixed(2), repIso(g.first), repIso(g.last)]));
  }
  if (key === "extras") {
    return head.concat([["Extra", "Bookings", "Quantity", "Taken by %", "Per booking", "Revenue"]],
      out.rows.map((e) => [e.name, e.bookings, e.qty, (e.attach * 100).toFixed(1), e.avg.toFixed(2), e.revenue.toFixed(2)]),
      [["Extra-person fees", "", "", "", "", out.extraPerson.toFixed(2)]]);
  }
  if (key === "tax") {
    return head.concat([["Month", "Taxable revenue", ...out.names, "Total tax", "Paid by guests", "Still to collect"]],
      out.rows.map((row) => [row.label, row.taxable.toFixed(2), ...out.names.map((n) => row.rules[n].toFixed(2)), row.tax.toFixed(2), row.paid.toFixed(2), r2(row.tax - row.paid).toFixed(2)]),
      [["Total", out.taxable.toFixed(2), ...out.names.map((n) => out.rules[n].toFixed(2)), out.tax.toFixed(2), out.paid.toFixed(2), r2(out.tax - out.paid).toFixed(2)]]);
  }
  if (key === "accounting") {
    const s = out.sales;
    return head.concat([["Account", "Amount"], ["Lodging", s.room.toFixed(2)], ["Extra person fees", s.extraPerson.toFixed(2)], ["Extras", s.extras.toFixed(2)], ["Discounts", (-s.discount).toFixed(2)]],
      Object.entries(s.taxes).map(([n, v]) => [n + " (tax)", v.toFixed(2)]), [["Total invoiced", s.total.toFixed(2)], ["", ""], ["Payment method", "Payments", "Received", "Refunded", "Net"]],
      out.byMethod.map((x) => [x.method, x.count, x.received.toFixed(2), x.refunded.toFixed(2), x.net.toFixed(2)]));
  }
  if (key === "balances") {
    return [["Group", "Booking", "Guest", "Email", "Phone", "Room", "Check-in", "Check-out", "Status", "Total", "Paid", "Due"]].concat(
      ...out.groups.map((g) => g.list.map((r) => [g.label, r.ref, r.guest, r.email || "", r.phone || "", r.room, r.checkIn || repIso(r.inN), r.checkOut || repIso(r.outN), r.status, r.total.toFixed(2), r.paid.toFixed(2), balance(r).toFixed(2)])));
  }
  if (key === "daily") {
    const row = (what) => (r) => [what, r.room, r.ref, r.guest, r.email || "", r.phone || "", r.checkIn || repIso(r.inN), r.checkOut || repIso(r.outN), r.adults || "", r.children || "", r.arrival || "", r.status, balance(r).toFixed(2)];
    return [["Date", repState.day], ["", ""], ["List", "Room", "Booking", "Guest", "Email", "Phone", "Check-in", "Check-out", "Adults", "Children", "Arrival time", "Status", "Due"]]
      .concat(out.arrivals.map(row("Arrival")), out.departures.map(row("Departure")), out.staying.map(row("Staying over")));
  }
  return head;
}
/* QuickBooks Online: one invoice per booking, its lines as products/services. */
function repInvoiceRows(a) {
  return [["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Memo", "Item(Product/Service)", "ItemDescription", "ItemQuantity", "ItemRate", "ItemAmount"]].concat(
    ...a.invoices.map((inv) => inv.items.map((it) => [inv.r.ref, repName(inv.r), qbDate(inv.date), qbDate(inv.due), `${inv.r.room} · ${inv.date} to ${inv.due}`,
      it.item, it.desc, it.qty, it.rate.toFixed(2), it.amount.toFixed(2)])));
}
function repPaymentRows(a) {
  return [["Date", "Description", "Amount", "Booking", "Customer", "Method", "Type", "Guest card fee"]].concat(
    a.payments.map((t) => [qbDate(t.date), `${t.amount < 0 ? "Refund" : "Payment"} · ${t.ref || ""} · ${t.guest || ""}`.replace(/ · $/, ""), t.amount.toFixed(2), t.ref || "", t.guest || "", REP_METHOD(t.method), t.amount < 0 ? "Refund" : "Payment", (t.fee || 0).toFixed(2)]));
}

/* ---------------------------------------------------------------- screen */
let repSeq = 0, repLast = null;
const repActive = () => !!document.querySelector("#view-reports.active");
function repSubtitle(meta) {
  if (meta.range === "range") return `${meta.sub} · ${dstr(new Date(repState.from + "T12:00:00"))} – ${dstr(new Date(repState.to + "T12:00:00"))}${repState.preset === "all" || repState.from.slice(0, 4) !== repState.to.slice(0, 4) || repState.to.slice(0, 4) !== String(TODAY.getFullYear()) ? `, ${repState.to.slice(0, 4)}` : ""}`;
  if (meta.range === "day") return `${meta.sub} · ${new Date(repState.day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;
  return meta.sub;
}
function repChrome() {
  const meta = REPORTS.find((x) => x.key === repState.tab) || REPORTS[0];
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("#repTitle", meta.label);
  set("#repSub", repSubtitle(meta));
  const bar = $("#repRangeBar"), day = $("#repDayBar");
  if (bar) bar.hidden = meta.range !== "range";
  if (day) day.hidden = meta.range !== "day";
  if ($("#repPreset")) $("#repPreset").value = repState.preset;
  if ($("#repFrom")) $("#repFrom").value = repState.from;
  if ($("#repTo")) $("#repTo").value = repState.to;
  if ($("#repDay")) $("#repDay").value = repState.day;
  $$("#navReports [data-report]").forEach((b) => b.classList.toggle("active", b.dataset.report === repState.tab));
  return meta;
}
/* Work out the open report; returns { key, out, html }. */
async function repCompute(key) {
  if (key === "balances") { const out = computeBalances(); return { key, out, html: repBalancesHTML(out) }; }
  if (key === "daily") {
    const D = repOff(repState.day);
    const data = repLive() && repState.day < SHDB.historyStart() ? await repLoad(repState.day, repState.day, {}) : { res: repLive() ? reservations : demoData().res };
    const out = computeDaily(data, D);
    return { key, out, html: repDailyHTML(out, D) };
  }
  let from = repState.from, to = repState.to;
  if (repState.preset === "all") {
    const data = await repLoad("1900-01-01", "2999-12-31", REP_NEEDS[key]);
    const firm = data.res.filter((r) => r.status !== "cancelled");
    from = firm.length ? repIso(Math.min(...firm.map((r) => r.inN))) : isoLocal(TODAY);
    to = firm.length ? repIso(Math.max(0, ...firm.map((r) => r.outN - 1))) : isoLocal(TODAY);
    repState.from = from; repState.to = to;
    return repFrom(key, data, repOff(from), repOff(to));
  }
  const F = repOff(from), T = repOff(to);
  if (key === "statistics") {
    const span = T - F + 1;
    const data = await repLoad(repIso(F - span), to, REP_NEEDS[key]);
    const out = { cur: computeStats(data, F, T), prev: computeStats(data, F - span, F - 1) };
    return { key, out, html: repStatsHTML(out.cur, out.prev) };
  }
  return repFrom(key, await repLoad(from, to, REP_NEEDS[key]), F, T);
}
function repFrom(key, data, F, T) {
  if (key === "revenue") { const out = computeRevenue(data, F, T); return { key, out, html: repRevenueHTML(out) }; }
  if (key === "statistics") { const out = { cur: computeStats(data, F, T), prev: null }; return { key, out, html: repStatsHTML(out.cur, null) }; }
  if (key === "occupancy") { const out = computeOccupancy(data, F, T); return { key, out, html: repOccupancyHTML(out) }; }
  if (key === "guests") { const out = computeGuests(data, F, T); return { key, out, html: repGuestsHTML(out) }; }
  if (key === "extras") { const out = computeExtras(data, F, T); return { key, out, html: repExtrasHTML(out) }; }
  if (key === "tax") { const out = computeTax(data, F, T); return { key, out, html: repTaxHTML(out) }; }
  const out = computeAccounting(data, F, T);
  return { key, out, html: repAccountingHTML(out) };
}
async function repRender() {
  if (!repActive()) return; // drawn when Reports opens
  const seq = ++repSeq, body = $("#repBody");
  if (!body) return;
  repChrome();
  const slow = setTimeout(() => { if (seq === repSeq) body.innerHTML = `<div class="card card-pad"><div class="empty">Loading this report…</div></div>`; }, 150);
  try {
    const res = await repCompute(repState.tab);
    if (seq !== repSeq) return;
    repLast = res;
    repChrome(); // "All time" now knows its dates
    body.innerHTML = res.html;
  } catch (e) {
    if (seq !== repSeq) return;
    body.innerHTML = `<div class="card card-pad"><div class="empty">This report couldn't load. Check your connection and try again.</div></div>`;
    if (window.SHReportError) window.SHReportError(e, "report " + repState.tab);
  } finally { clearTimeout(slow); }
}
function repShow(tab, history = "push") {
  if (!REPORTS.some((x) => x.key === tab)) tab = "revenue";
  repState.tab = tab;
  repState.query = "";
  if (!repActive()) { goto("reports"); return; } // its sh-view sets the address and draws
  try { window.history[history === "push" ? "pushState" : "replaceState"](null, "", "#reports/" + tab); } catch { /* sandboxed */ }
  repRender();
}
function repDownload(rows, what) {
  downloadCsv(rows, `${fileStem()}-${what}-${repState.tab === "daily" ? repState.day : repState.from + "-to-" + repState.to}.csv`);
}

/* Sidebar sub-items, built once. */
(function repNav() {
  const nav = $("#navReports");
  if (!nav) return;
  nav.innerHTML = REPORTS.map((x) => `<button class="nav-sub-btn" data-report="${x.key}" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${REP_ICON[x.key]}</svg>${esc(x.label)}</button>`).join("");
})();
document.addEventListener("click", (e) => {
  const sub = e.target.closest("#navReports [data-report]");
  if (sub) { document.body.classList.remove("nav-open"); repShow(sub.dataset.report); return; }
  const ex = e.target.closest("[data-rep-export]");
  if (ex && repLast && repLast.key === "accounting") {
    repDownload(ex.dataset.repExport === "invoices" ? repInvoiceRows(repLast.out) : repPaymentRows(repLast.out), ex.dataset.repExport === "invoices" ? "quickbooks-invoices" : "payments");
  }
});
document.addEventListener("change", (e) => {
  const id = e.target && e.target.id;
  if (id === "repPreset") {
    repState.preset = e.target.value;
    if (repState.preset !== "custom" && repState.preset !== "all") Object.assign(repState, presetRange(repState.preset));
    repRender();
  } else if (id === "repFrom" || id === "repTo") {
    const from = $("#repFrom").value, to = $("#repTo").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    repState.preset = "custom";
    // Keep the dates in order and the period under ten years.
    const [a, b] = from <= to ? [from, to] : [to, from];
    repState.from = a; repState.to = repOff(b) - repOff(a) > 3660 ? repIso(repOff(a) + 3660) : b;
    repRender();
  } else if (id === "repDay" && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
    repState.day = e.target.value;
    repRender();
  }
});
document.addEventListener("input", (e) => {
  if (!e.target || e.target.id !== "repGuestSearch" || !repLast || repLast.key !== "guests") return;
  repState.query = e.target.value;
  const pos = e.target.selectionStart;
  $("#repBody").innerHTML = repGuestsHTML(repLast.out);
  const box = $("#repGuestSearch");
  if (box) { box.focus(); try { box.setSelectionRange(pos, pos); } catch { /* type=search */ } }
});
/* Reports opens on the sub-report in the address (#reports/tax), and the
   sub-items show while it's open. */
window.addEventListener("sh-view", (e) => {
  const view = e.detail && e.detail.view, nav = $("#navReports");
  if (nav) nav.hidden = view !== "reports";
  if (view !== "reports") return;
  const sub = decodeURIComponent(location.hash.replace(/^#/, "")).split("/")[1];
  repState.tab = REPORTS.some((x) => x.key === sub) ? sub : repState.tab;
  try { window.history.replaceState(null, "", "#reports/" + repState.tab); } catch { /* sandboxed */ }
  repRender();
});

window.SHReports = {
  REPORTS, presetRange, repOff, stayMoney, taxSplit, computeRevenue, computeStats, computeOccupancy, computeGuests,
  computeExtras, computeTax, computeAccounting, computeBalances, computeDaily, repExportRows, repInvoiceRows, repPaymentRows,
  render: repRender,
  exportCsv() {
    if (!repLast) return;
    repDownload(repExportRows(repLast.key, repLast.out), "report-" + repLast.key);
  }
};
if (repActive()) {
  const nav = $("#navReports"); if (nav) nav.hidden = false;
  window.dispatchEvent(new CustomEvent("sh-view", { detail: { view: "reports" } }));
}
