/* SimpleHotelier — date and time pickers for the dashboard.
   Every <input type="date"> and every <input data-picker="time"> gets a
   themed picker. The input stays in the page (hidden) and keeps its value,
   so code that reads or sets .value, or listens for input/change, works
   unchanged. Dates are YYYY-MM-DD; times are "h:mm AM/PM", as properties
   store them. Inputs added later (modals, re-rendered panels) are picked
   up too.
   Pairs: data-pk-end="<id>" on a start date opens the end date next, and
   data-pk-start="<id>" on the end date shades the range (data-pk-gap="1"
   when the end must be at least a night later, like check-out). */
(function () {
  "use strict";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parseIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  function addMonths(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
    return x;
  }
  /* The 6 × 7 days shown for a month, weeks starting on Sunday. */
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const start = addDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }
  const fmtDate = (s) => { const d = parseIso(s); return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : ""; };
  const longDate = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const nightsBetween = (a, b) => Math.round((b - a) / 864e5);

  /* Minutes after midnight from "3:00 PM", "3pm", "3:15 p", "15:15",
     "1515", "noon" or "midnight"; null when it isn't a time. */
  function parseTime(s) {
    const t = String(s || "").trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
    if (!t) return null;
    if (t === "noon") return 720;
    if (t === "midnight") return 0;
    const m = /^(\d{1,2})(?::?(\d{2}))? ?([ap])?m?$/.exec(t);
    if (!m) return null;
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (min > 59) return null;
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (m[3] === "p" ? 12 : 0);
    } else if (h > 23) return null;
    return h * 60 + min;
  }
  const fmtTime = (mins) => { const h = Math.floor(mins / 60) % 24; return `${h % 12 || 12}:${pad(mins % 60)} ${h < 12 ? "AM" : "PM"}`; };
  const timeList = (step) => Array.from({ length: Math.floor(1440 / step) }, (_, i) => i * step);

  const ICON = {
    date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    time: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>'
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------------------------------------------------------- fields */
  const valueDesc = typeof HTMLInputElement !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") : null;
  const kindOf = (input) => (input.type === "date" ? "date" : input.dataset.picker === "time" ? "time" : "");
  const fieldOf = (input) => input.nextElementSibling && input.nextElementSibling.classList.contains("pk-field") ? input.nextElementSibling : null;
  function paint(input) {
    const btn = fieldOf(input);
    if (!btn) return;
    const kind = kindOf(input), v = valueDesc.get.call(input);
    const mins = kind === "time" ? parseTime(v) : null;
    const text = kind === "date" ? fmtDate(v) : mins != null ? fmtTime(mins) : v;
    btn.innerHTML = ICON[kind] + `<span class="pk-text">${esc(text || input.getAttribute("placeholder") || (kind === "date" ? "Choose a date" : "Choose a time"))}</span>`;
    btn.classList.toggle("pk-empty", !text);
    btn.disabled = input.disabled;
  }
  function enhance(input) {
    const kind = kindOf(input);
    if (!kind || input.dataset.pkDone) return;
    input.dataset.pkDone = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "input pk-field pk-" + kind;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    if (input.id) {
      btn.id = input.id + "-pk";
      // Named by its <label for>, or the label in the same field.
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`) ||
        (input.parentElement && input.parentElement.querySelector && input.parentElement.querySelector(":scope > label"));
      if (label) { if (!label.id) label.id = input.id + "-label"; btn.setAttribute("aria-labelledby", label.id + " " + btn.id); }
    }
    if (!btn.hasAttribute("aria-labelledby") && input.getAttribute("aria-label")) btn.setAttribute("aria-label", input.getAttribute("aria-label"));
    input.classList.add("pk-native");
    input.tabIndex = -1;
    input.setAttribute("aria-hidden", "true");
    input.after(btn);
    // Code that sets .value directly repaints the field.
    Object.defineProperty(input, "value", {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); paint(this); }
    });
    // A <label for> click or input.focus() opens the picker instead.
    input.addEventListener("focus", () => { if (!input.disabled) open(input); });
    paint(input);
  }
  function enhanceAll(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type="date"], input[data-picker="time"]')) enhance(root);
    root.querySelectorAll('input[type="date"], input[data-picker="time"]').forEach(enhance);
  }
  function setValue(input, v) {
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* ---------------------------------------------------------------- popover */
  let pop = null, cur = null; // cur: { input, kind, view (Date), focus (Date), mode: "days" | "months" }
  function close(refocus) {
    if (!pop) return;
    pop.remove(); pop = null;
    if (cur) {
      const btn = fieldOf(cur.input);
      if (btn) { btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); }
    }
    cur = null;
  }
  function open(input) {
    if (cur && cur.input === input) return;
    close(false);
    const kind = kindOf(input), btn = fieldOf(input);
    if (!btn || btn.disabled) return;
    const v = valueDesc.get.call(input);
    const start = input.dataset.pkStart ? document.getElementById(input.dataset.pkStart) : null;
    const startDate = start ? parseIso(valueDesc.get.call(start)) : null;
    // Open on the chosen date; an end date that's now before its start opens at the start.
    const sel = parseIso(v), firstEnd = startDate ? addDays(startDate, +(input.dataset.pkGap || 0)) : null;
    const base = (kind === "date" && (sel && !(firstEnd && sel < firstEnd) ? sel : firstEnd)) || new Date(new Date().setHours(0, 0, 0, 0));
    cur = { input, kind, view: new Date(base.getFullYear(), base.getMonth(), 1), focus: base, mode: "days", startDate };
    pop = document.createElement("div");
    pop.className = "pk-pop pk-pop-" + kind;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", kind === "date" ? "Choose a date" : "Choose a time");
    document.body.appendChild(pop);
    btn.setAttribute("aria-expanded", "true");
    render();
    place();
    focusInside();
  }
  function place() {
    if (!pop || !cur) return;
    const btn = fieldOf(cur.input);
    if (!btn || !btn.isConnected) { close(false); return; }
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, gap = 6;
    const below = r.bottom + gap + h <= innerHeight - 8 || r.top - gap - h < 8;
    pop.style.top = Math.max(8, below ? r.bottom + gap : r.top - gap - h) + "px";
    pop.style.left = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8)) + "px";
  }
  function inRange(d, input) {
    const min = parseIso(input.min), max = parseIso(input.max);
    if (min && d < min) return false;
    if (max && d > max) return false;
    if (cur && cur.startDate && input.dataset.pkGap && d < addDays(cur.startDate, +input.dataset.pkGap)) return false;
    return true;
  }
  function render() {
    if (!pop || !cur) return;
    if (cur.kind === "time") return renderTime();
    const { input, view, focus } = cur;
    const sel = parseIso(valueDesc.get.call(input)), today = new Date(new Date().setHours(0, 0, 0, 0));
    const head = (title, label) => `<div class="pk-head">
        <button type="button" class="pk-nav" data-pk="prev" aria-label="Previous ${label}">${ICON.prev}</button>
        <button type="button" class="pk-title" data-pk="${cur.mode === "days" ? "months" : "days"}" aria-label="${cur.mode === "days" ? "Choose month and year" : "Back to days"}">${title}</button>
        <button type="button" class="pk-nav" data-pk="next" aria-label="Next ${label}">${ICON.next}</button></div>`;
    if (cur.mode === "months") {
      const y = view.getFullYear();
      pop.innerHTML = head(String(y), "year") + `<div class="pk-months">${MONTHS.map((m, i) =>
        `<button type="button" class="pk-month${sel && sel.getFullYear() === y && sel.getMonth() === i ? " sel" : ""}${today.getFullYear() === y && today.getMonth() === i ? " now" : ""}" data-pk-month="${i}">${m.slice(0, 3)}</button>`).join("")}</div>`;
      return;
    }
    const start = cur.startDate, end = sel;
    const days = monthGrid(view.getFullYear(), view.getMonth()).map((d) => {
      const key = iso(d), cls = ["pk-day"];
      if (d.getMonth() !== view.getMonth()) cls.push("out");
      if (+d === +today) cls.push("today");
      if (sel && +d === +sel) cls.push("sel");
      if (start && +d === +start) cls.push("edge");
      if (start && end && d > start && d < end) cls.push("range");
      const ok = inRange(d, input);
      return `<button type="button" class="${cls.join(" ")}" data-pk-date="${key}" tabindex="${+d === +focus ? 0 : -1}" aria-label="${esc(longDate(d))}"${sel && +d === +sel ? ' aria-pressed="true"' : ""}${ok ? "" : " disabled"}>${d.getDate()}</button>`;
    }).join("");
    const n = start && sel ? nightsBetween(start, sel) : null;
    pop.innerHTML = head(`${MONTHS[view.getMonth()]} ${view.getFullYear()}`, "month") +
      `<div class="pk-dow" aria-hidden="true">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="pk-grid">${days}</div>
      <div class="pk-foot"><button type="button" class="pk-link" data-pk="today"${inRange(today, input) ? "" : " disabled"}>Today</button>
        <span class="pk-note">${n != null && n > 0 ? `${n} night${n === 1 ? "" : "s"}` : start ? `From ${esc(fmtDate(iso(start)))}` : ""}</span></div>`;
  }
  function renderTime() {
    const { input } = cur;
    const step = Math.max(5, Math.min(60, +(input.dataset.step || 30)));
    const now = parseTime(valueDesc.get.call(input));
    const near = now == null ? 15 * 60 : Math.round(now / step) * step % 1440;
    pop.innerHTML = `<input class="input pk-type" type="text" inputmode="text" autocomplete="off" placeholder="Type a time, like 4:30 PM" aria-label="Type a time">
      <div class="pk-times" role="listbox" aria-label="Times">${timeList(step).map((m) =>
        `<button type="button" class="pk-opt${now === m ? " sel" : ""}" role="option" aria-selected="${now === m}" data-pk-time="${m}" tabindex="${m === near ? 0 : -1}">${fmtTime(m)}</button>`).join("")}</div>
      <p class="pk-err" hidden>Try a time like 3:00 PM.</p>`;
    const list = pop.querySelector(".pk-times"), at = list.querySelector(`[data-pk-time="${near}"]`);
    if (at) list.scrollTop = at.offsetTop - list.clientHeight / 2 + at.offsetHeight / 2;
  }
  function focusInside() {
    if (!pop) return;
    const el = cur.kind === "time" ? pop.querySelector(".pk-opt.sel, .pk-opt[tabindex='0']")
      : pop.querySelector(".pk-day[tabindex='0']:not([disabled])") || pop.querySelector(".pk-day:not([disabled]):not(.out)") || pop.querySelector(".pk-month.sel, .pk-month");
    if (el) el.focus({ preventScroll: true });
  }
  function moveFocus(to) {
    cur.focus = to;
    if (to.getMonth() !== cur.view.getMonth() || to.getFullYear() !== cur.view.getFullYear()) cur.view = new Date(to.getFullYear(), to.getMonth(), 1);
    render();
    focusInside();
  }
  function pickDate(key) {
    const input = cur.input, endId = input.dataset.pkEnd;
    close(!endId);
    setValue(input, key);
    // A start date opens its end date next (check-in, then check-out).
    if (endId) setTimeout(() => { const end = document.getElementById(endId); if (end && fieldOf(end) && !end.disabled) open(end); else { const b = fieldOf(input); if (b) b.focus(); } }, 0);
  }
  function pickTime(mins) {
    const input = cur.input;
    close(true);
    setValue(input, fmtTime(mins));
  }

  window.SHPickers = { enhanceAll, parseTime, fmtTime, timeList, monthGrid, parseIso, fmtDate, close };

  /* ---------------------------------------------------------------- events */
  if (typeof document === "undefined" || !document.addEventListener) return;
  document.addEventListener("click", (e) => {
    const field = e.target.closest(".pk-field");
    if (field) {
      const input = field.previousElementSibling;
      if (cur && cur.input === input) close(true); else if (input) open(input);
      return;
    }
    if (!pop || !pop.contains(e.target)) return;
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.pkDate) pickDate(b.dataset.pkDate);
    else if (b.dataset.pkTime) pickTime(+b.dataset.pkTime);
    else if (b.dataset.pkMonth) { cur.view = new Date(cur.view.getFullYear(), +b.dataset.pkMonth, 1); cur.focus = new Date(cur.view); cur.mode = "days"; render(); place(); focusInside(); }
    else if (b.dataset.pk === "prev" || b.dataset.pk === "next") {
      const dir = b.dataset.pk === "prev" ? -1 : 1;
      cur.view = cur.mode === "months" ? new Date(cur.view.getFullYear() + dir, 0, 1) : addMonths(cur.view, dir);
      cur.focus = new Date(cur.view.getFullYear(), cur.view.getMonth(), Math.min(cur.focus.getDate(), 28));
      render(); place();
      const again = pop.querySelector(`[data-pk="${b.dataset.pk}"]`); if (again) again.focus();
    } else if (b.dataset.pk === "months" || b.dataset.pk === "days") { cur.mode = b.dataset.pk; render(); place(); focusInside(); }
    else if (b.dataset.pk === "today") pickDate(iso(new Date()));
  });
  // Outside the picker and its field: close.
  document.addEventListener("pointerdown", (e) => {
    if (!pop || pop.contains(e.target)) return;
    const field = e.target.closest && e.target.closest(".pk-field");
    if (field && cur && field === fieldOf(cur.input)) return;
    close(false);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!pop || !cur) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === "Tab" && pop.contains(document.activeElement)) {
      // Keep Tab inside the picker while it's open.
      const items = [...pop.querySelectorAll("button:not([disabled]), input")].filter((x) => x.tabIndex !== -1 || x === document.activeElement);
      const i = items.indexOf(document.activeElement);
      if (items.length) { e.preventDefault(); items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus(); }
      return;
    }
    if (cur.kind === "time") {
      if (e.target.classList.contains("pk-type")) {
        if (e.key === "Enter") {
          e.preventDefault();
          const m = parseTime(e.target.value);
          if (m == null) pop.querySelector(".pk-err").hidden = false; else pickTime(m);
        } else if (e.key === "ArrowDown") { e.preventDefault(); focusInside(); }
        return;
      }
      const opt = e.target.closest(".pk-opt");
      if (!opt) return;
      const opts = [...pop.querySelectorAll(".pk-opt")], i = opts.indexOf(opt);
      const go = { ArrowDown: 1, ArrowUp: -1, PageDown: 4, PageUp: -4, Home: -i, End: opts.length - 1 - i }[e.key];
      if (go != null) { e.preventDefault(); const t = opts[Math.max(0, Math.min(opts.length - 1, i + go))]; opt.tabIndex = -1; t.tabIndex = 0; t.focus(); }
      return;
    }
    const day = e.target.closest(".pk-day");
    if (!day || cur.mode !== "days") return;
    const f = cur.focus;
    const to = { ArrowLeft: addDays(f, -1), ArrowRight: addDays(f, 1), ArrowUp: addDays(f, -7), ArrowDown: addDays(f, 7),
      PageUp: addMonths(f, e.shiftKey ? -12 : -1), PageDown: addMonths(f, e.shiftKey ? 12 : 1), Home: addDays(f, -f.getDay()), End: addDays(f, 6 - f.getDay()) }[e.key];
    if (to) { e.preventDefault(); moveFocus(to); }
  }, true);
  document.addEventListener("input", (e) => { if (pop && e.target.classList && e.target.classList.contains("pk-type")) pop.querySelector(".pk-err").hidden = true; });
  addEventListener("resize", place);
  addEventListener("scroll", place, true);

  // Disabled inputs disable their field; new inputs get a picker.
  const watch = new MutationObserver((list) => {
    list.forEach((m) => {
      if (m.type === "attributes") { if (m.target.dataset && m.target.dataset.pkDone) paint(m.target); return; }
      m.addedNodes.forEach((n) => { if (n.nodeType === 1) enhanceAll(n); });
      if (cur && !cur.input.isConnected) close(false);
    });
  });
  const start = () => {
    enhanceAll(document.body);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

})();
