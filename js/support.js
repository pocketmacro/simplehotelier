/* SimpleHotelier — Support portal, Spark assistant, System Admin, billing.
   Spark tries the support-ai Edge Function first (muse-spark), then falls
   back to the built-in help articles below so help always works. */
"use strict";

(function () {
  const SITE = window.SH_SITE; // the platform: name, plan (js/site.js)
  const ARTICLES = [
    { id: "rooms", keys: ["add cabin", "add room", "new cabin", "new room", "add a unit", "create room"], title: "Adding rooms and cabins", body: "1. Open Rooms & Cabins.\n2. Choose Add unit.\n3. Enter the code (like D1), name, how many it sleeps, and the nightly rate.\n4. Save. The room appears on your booking page right away. Add photos from the room card next." },
    { id: "rates", keys: ["rate", "price", "weekend price", "change price", "pricing", "rate plan", "promo", "discount", "extended stay"], title: "Rates", body: "Prices live on room types, not individual rooms — set the nightly rate on the type (Rooms & Cabins → Room Types, or the Rates page) and every room of that type inherits it. The prices on the type itself form its Default Rate, which always shows on the Rates page; extra rates (extended stay, promo-only) sit alongside it. For date-specific prices, open Rate Calendar, pick the room type, and click any day (or use the Bulk updater for ranges). Days without an override use the type's nightly rate. For stay-length or promo-code pricing, open Rates and add a rate to the type — e.g. an Extended stay rate at -10% for 3 to 30 nights. Guests see the best applicable plan on your booking page. Changes apply to new bookings only." },
    { id: "housekeeping", keys: ["clean", "dirty", "housekeeping", "cleaner", "turnover"], title: "Clean and dirty flags", body: "Open Housekeeping for the turnover board, or use the Dirty / In progress / Clean buttons on any room card. Cleaners can open the app on their phones: they only need to flag rooms as they finish. The front desk sees every change instantly." },
    { id: "charge", keys: ["charge", "payment", "card", "stripe connect", "get paid", "folio", "balance"], title: "Charging a guest", body: `1. Open Payments (or a reservation) and find the open balance.\n2. Choose Charge and enter the amount. Cards run through your connected Stripe account.\n3. Not connected yet? Settings walks you through Stripe onboarding. Guest money settles to your Stripe account, never to ${SITE.name}.` },
    { id: "taxes", keys: ["tax", "taxes", "lodging tax", "tourism fee"], title: "How taxes work", body: "Open Add-ons & Taxes. Each rule is either a percent (of the room, or room plus add-ons) or a flat per-night amount. Rules stack in order, and the breakdown preview shows exactly what a guest pays on a $200 night. The same math runs on your booking page." },
    { id: "addons", keys: ["add-on", "addon", "extra charge", "firewood", "breakfast", "pet fee", "late checkout"], title: "Add-on charges", body: "Open Add-ons & Taxes and choose Add-on. Set a name, price, and whether it is per stay, per night, or per person. Shown add-ons appear at checkout on your booking page and can be added to folios." },
    { id: "booking", keys: ["booking page", "publish", "headline", "brand color", "direct booking"], title: "Your booking page", body: "Open Booking Page in the sidebar. Edit the name, headline, colors and page address on the left and watch the preview update. Choose Publish changes to save. Guests book at your page address with real availability, so a booked night cannot be requested twice." },
    { id: "embed", keys: ["embed", "website", "iframe", "widget", "my site", "wordpress", "squarespace", "wix"], title: "Embed booking on your website", body: "1. Open Booking Page.\n2. Find Embed on your website and copy the snippet.\n3. Paste it into your site (an HTML or embed block in WordPress, Squarespace, Wix, or hand-built pages).\nThe widget is full-width on phones and grows to fit its content automatically, with no inner scrollbars." },
    { id: "analytics", keys: ["google analytics", "analytics", "conversion", "tracking", "redirect", "thank you page", "ads"], title: "Conversions and analytics", body: `Open Booking Page, then Conversion tracking. Paste your Google Analytics Measurement ID (G-...) and ${SITE.name} fires a purchase and booking_complete event when a booking finishes. Or set a redirect URL and guests land on your thank-you page with the booking reference and total in the address, ready for ads tracking.` },
    { id: "availability", keys: ["availability", "double book", "overlap", "booked twice", "calendar", "block dates"], title: "Availability and double bookings", body: `The Calendar shows every room across 14 days. ${SITE.name} blocks overlapping stays at the database level: two guests cannot hold the same room for the same night, even at the same second. To close dates without a guest, create a reservation and mark it as an owner hold in the notes.` },
    { id: "reports", keys: ["report", "revenue", "occupancy", "tax owed", "top room"], title: "Reports", body: "Open Reports for revenue, occupancy, average nightly rate and balance due, revenue by night, where bookings come from, your top units, and tax by rule: charged, paid by guests so far and still to collect. Pick the last 7, 30 or 90 days, or the next 30 days to see what's on the books. A stay counts on the nights guests stay (a week-long stay shows up in each week it touches), revenue is before tax, and requests awaiting confirmation aren't counted. Export CSV gives your bookkeeper the same numbers with dates." },
    { id: "maintenance", keys: ["maintenance", "repair", "broken", "leak", "fix", "issue", "ticket"], title: "Maintenance tickets", body: "Open Maintenance and choose New ticket: describe the issue, pick the room, set a priority, and add a photo if it helps. Move tickets from Open to In progress to Done as work happens. The sidebar badge counts anything unfinished, and housekeeping can flag problems the moment they spot them." },
    { id: "ical", keys: ["airbnb", "vrbo", "ical", "sync", "channel", "export calendar", "import calendar"], title: "Airbnb / Vrbo calendar sync", body: `Open Booking Page, then External calendars. Copy your ${SITE.name} calendar link into Airbnb/Vrbo (their Import Calendar setting) so direct bookings block those dates. Then add each Airbnb/Vrbo listing's calendar URL here, matched to its room — their bookings block yours. Feeds sync daily and on demand with Sync now.` },
    { id: "emails", keys: ["email", "confirmation email", "reminder", "receipt", "weekly report", "guest email"], title: "Guest and owner emails", body: "Guests automatically get a booking confirmation (or request received) email, a reminder the day before check-in and check-out, and a receipt whenever you charge them. You get a new-booking email at your Settings notification address, plus a weekly report every Monday with occupancy, revenue and upcoming arrivals. Make sure your booking email is set in Settings." },
    { id: "account", keys: ["password", "change my email", "change email", "login email", "my email address", "display name", "my name", "your account", "my account"], title: "Your name, email and password", body: "Click your name at the bottom of the sidebar to open Your account (owners can also find it in Settings).\n1. Display name: what your team sees instead of your email.\n2. Login email: enter the new one and we email a confirmation link to both your old and new address. Open both, and the new email becomes your login.\n3. Password: enter your current password, then the new one twice.\nForgot your current password? Sign out and choose Forgot password? on the login screen." },
    { id: "team", keys: ["invite", "team", "staff", "cleaner access", "add user"], title: "Inviting your team", body: "Open Settings and choose Invite your team. Enter their email, pick a role (cleaner, maintenance, staff, or admin), and send — they get an email invite that is stored for your property. When they create their free account with that email, they join your property automatically with that role: no property setup, card, or trial. Pending invites wait in Settings under Team & invites, where you can revoke them." },
    { id: "billing", keys: ["subscription", "billing", SITE.priceLabel, "per month", "cancel", "plan", "invoice"], title: `Your ${SITE.priceLabel}/month subscription`, body: `${SITE.name} is one flat ${SITE.priceLabel} per month with every feature included and no commission on your bookings. Manage it in Settings, under Plan and billing. Checkout and invoices run through Stripe. Cancel any time there; your data stays readable until the end of the paid month. This subscription is separate from guest payments, which go to your own Stripe account.` },
    { id: "stays", keys: ["pending", "booking status", "check in", "check-in", "checked in", "check out a guest", "check them out", "checked out", "in-house", "in house", "confirm a booking", "confirm booking", "confirm a request", "booking request", "awaiting card"], title: "Pending, confirmed, in-house, checked out", body: "Each booking moves Pending → Confirmed → In-house → Checked out, with one button for the next step in Reservations and on Today's movement.\n1. Pending: a request nobody has paid for yet, such as an online booking made while Stripe isn't connected. Choose Confirm and the guest gets their confirmation email. Online bookings with a deposit paid or a card saved are confirmed automatically, and so is any pending booking you take a payment for. One still waiting for its card shows Awaiting card and is released after 30 minutes.\n2. Check in: when the guest arrives (from their check-in day), choose Check in. They show as In-house and the room as Occupied.\n3. Check out: choose Check out when they leave. If they still owe money, the booking opens on its payment panel first; paying the balance in full checks them out, or choose Check out anyway. The room is flagged Dirty for housekeeping." },
  ];

  /* Screen names in answers become buttons that jump to that view. */
  const SCREEN_LINKS = [
    ["Add-ons & Taxes", "addons"], ["Rooms & Cabins", "rooms"], ["Booking Page", "booking"],
    ["Housekeeping", "housekeeping"], ["Maintenance", "maintenance"], ["Reservations", "reservations"], ["Payments", "payments"],
    ["Calendar", "calendar"], ["Reports", "reports"], ["Rates", "ratemgmt"], ["Rate Calendar", "rates"], ["Settings", "settings"],
    ["Overview", "overview"], ["Support", "support"], ["Add unit", "rooms"],
    ["Publish changes", "booking"], ["Plan and billing", "settings"], ["Your account", "account"]
  ];
  const VIEW_LABELS = { addons: "Add-ons & Taxes", rooms: "Rooms & Cabins", booking: "Booking Page", housekeeping: "Housekeeping", maintenance: "Maintenance", reservations: "Reservations", payments: "Payments", calendar: "Calendar", reports: "Reports", ratemgmt: "Rates", rates: "Rate Calendar", settings: "Settings", overview: "Overview", support: "Support", account: "Your account" };
  function findLinks(text) {
    const lower = String(text || "").toLowerCase();
    const found = [], seen = new Set();
    [...SCREEN_LINKS].sort((a, b) => b[0].length - a[0].length).forEach(([name, view]) => {
      if (lower.includes(name.toLowerCase()) && !seen.has(view)) {
        seen.add(view);
        found.push({ name, view, label: VIEW_LABELS[view] || name });
      }
    });
    return found;
  }

  function answer(question) {
    const q = " " + String(question || "").toLowerCase().replace(/[^a-z0-9$ ]+/g, " ") + " ";
    let best = null, bestScore = 0;
    for (const a of ARTICLES) {
      let score = 0;
      for (const k of a.keys) {
        if (q.includes(" " + k) || q.includes(k)) score += k.includes(" ") ? 3 : 2;
      }
      if (score > bestScore) { bestScore = score; best = a; }
    }
    if (best && bestScore >= 2) return { id: best.id, title: best.title, body: best.body, fallback: false };
    return {
      id: "fallback", title: "Let me point you the right way", fallback: true,
      body: "I do not have a confident answer for that yet. Two fast options:\n1. Rephrase with the feature name (rooms, taxes, charging, booking page, embed).\n2. Open a support case below and our team will reply in this thread. Your question is saved with the case, so you will not need to repeat it."
    };
  }
  window.SHSupport = { answer, ARTICLES, findLinks };

  /* ---- DOM app ---- */
  if (!document.querySelector || !document.querySelector("#chatLog")) return;
  const $ = (s) => document.querySelector(s);
  const cfg = window.SH_CONFIG || {};
  /* Demo sessions (explicit opt-in, see js/app.js) get no Support access:
     no paid Spark AI calls and no cases — both are spam/cost vectors.
     The support-ai function also rejects anonymous callers server-side;
     this gate means the demo never even tries. */
  const isDemo = () => { try { return sessionStorage.getItem("sh_demo") === "1"; } catch { return false; } };
  const hasUserToken = () => {
    try {
      const t = localStorage.getItem("sh_access_token");
      return !!t && t !== cfg.SUPABASE_ANON_KEY;
    } catch { return false; }
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const myEmail = () => { try { return (JSON.parse(localStorage.getItem("sh_user") || "null") || {}).email || ""; } catch { return ""; } };
  let lastQuestion = "";
  let tenantNames = {};

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function linkify(text) {
    const names = [...SCREEN_LINKS].sort((a, b) => b[0].length - a[0].length);
    const re = new RegExp("(" + names.map(([n]) => escapeRe(n)).join("|") + ")", "gi");
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += esc(text.slice(last, m.index));
      const entry = names.find(([n]) => n.toLowerCase() === m[0].toLowerCase());
      out += `<button type="button" class="chat-link" data-goto-view="${entry[1]}">${esc(m[0])}</button>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }
  function answerHTML(title, text) {
    const links = findLinks((title || "") + " " + text);
    return (title ? `<p><strong>${esc(title)}</strong></p>` : "") +
      text.split("\n").map((l) => `<p>${linkify(l)}</p>`).join("") +
      (links.length ? `<div class="chat-actions">${links.slice(0, 2).map((l) => `<button class="btn btn-primary btn-xs" type="button" data-goto-view="${l.view}">Open ${esc(l.label)} →</button>`).join("")}</div>` : "");
  }
  function bubble(who, title, text) {
    const log = $("#chatLog");
    const d = document.createElement("div");
    d.className = "msg " + (who === "me" ? "me" : "ai");
    d.innerHTML = who === "ai"
      ? `<strong class="who">Spark</strong>` + answerHTML(title, text)
      : text.split("\n").map((l) => `<p>${esc(l)}</p>`).join("");
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  async function askSpark(text) {
    const q = (text || "").trim();
    if (!q) return;
    if (isDemo()) {
      bubble("ai", "Support is for accounts", "You're exploring the demo, so Spark and support cases are switched off here. Exit the demo from the sidebar and sign in — then ask me anything.");
      return;
    }
    lastQuestion = q;
    bubble("me", "", q);
    $("#chatInput").value = "";
    const thinking = bubble("ai", "", "Thinking…");
    let answered = null;
    try {
      // Paid API: only call it with a real user token, never the anon key.
      if (!hasUserToken()) throw new Error("not signed in");
      const token = localStorage.getItem("sh_access_token");
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 9000);
      const res = await fetch((cfg.SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/support-ai", {
        method: "POST", signal: ctl.signal,
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      clearTimeout(timer);
      if (res.ok) { const d = await res.json(); if (d.answer) answered = { title: "Spark", body: d.answer }; }
      else if (res.status === 429) {
        const local = answer(q);
        answered = { title: "Spark's daily limit is reached", body: "You've used today's Spark questions — it resets tomorrow. Here's the closest help article, or open a support case and our team will reply.\n\n" + local.body };
      }
    } catch { /* offline or function not deployed: local articles below */ }
    if (!answered) answered = answer(q);
    thinking.innerHTML = `<strong class="who">Spark</strong>` + answerHTML(answered.title, answered.body);
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  }

  /* Cases */
  const statusPill = (s) => ({ open: "pending", pending: "progress", resolved: "clean", closed: "neutral" }[s] || "neutral");
  async function loadMyCases() {
    const box = $("#myCases");
    if (isDemo()) { box.innerHTML = `<p class="hint">Support cases need an account — the demo can't open or view cases.</p>`; return; }
    if (!window.SHDB || !SHDB.hasLive()) { box.innerHTML = `<p class="hint">Sign in to see your cases, or create one above.</p>`; return; }
    try {
      const all = await SHDB.listSupportCases();
      const mine = (all || []).filter((c) => c.tenant_id === SHDB.tenantId());
      box.innerHTML = mine.map((c) => `
        <div class="row-item case-row" data-case="${c.id}">
          <div class="ri-main"><strong>${esc(c.subject)}</strong><span>${esc(c.category)} · ${new Date(c.updated_at).toLocaleDateString()}</span></div>
          <div class="ri-right"><span class="pill ${statusPill(c.status)}"><i></i>${esc(c.status)}</span></div>
        </div>`).join("") || `<p class="hint">No cases yet. You are all caught up.</p>`;
    } catch { box.innerHTML = `<p class="hint">Cases need the support migration (20261028000000). Ask Spark above in the meantime.</p>`; }
  }

  async function openCase(id, asAdmin) {
    let msgs = [];
    try { msgs = await SHDB.listSupportMessages(id); } catch { /* shown empty */ }
    const all = await SHDB.listSupportCases().catch(() => []);
    const c = (all || []).find((x) => x.id === id) || { subject: "Support case", status: "open" };
    openModal({
      title: c.subject, sub: (tenantNames[c.tenant_id] || "Your property") + " · " + c.category + " · " + c.status,
      body: `<div style="display:flex;flex-direction:column;gap:9px;max-height:300px;overflow-y:auto">` +
        msgs.map((m) => `<div class="msg ${m.sender === "user" && !asAdmin ? "me" : "ai"}" style="max-width:94%"><strong class="who">${esc(m.sender === "ai" ? "Spark" : m.sender)}</strong>${m.body.split("\n").map((l) => `<p>${esc(l)}</p>`).join("")}</div>`).join("") +
        `</div>
        <div class="field" style="margin-top:14px"><label>Reply</label><textarea class="textarea" id="caseReply" placeholder="Write a reply…"></textarea></div>
        ${asAdmin ? `<div class="field"><label>Status</label><select class="select" id="caseStatus"><option ${c.status === "open" ? "selected" : ""}>open</option><option ${c.status === "pending" ? "selected" : ""}>pending</option><option ${c.status === "resolved" ? "selected" : ""}>resolved</option><option ${c.status === "closed" ? "selected" : ""}>closed</option></select></div>` : ""}`,
      foot: `<button class="btn btn-ghost btn-sm" data-close type="button">Close</button><button class="btn btn-primary btn-sm" id="caseSend" type="button">Send reply</button>`,
      wide: true
    });
    $("#caseSend").addEventListener("click", async () => {
      const body = $("#caseReply").value.trim();
      if (!body) return;
      try {
        await SHDB.addSupportMessage(id, body, asAdmin ? "admin" : "user", myEmail());
        if (asAdmin) await SHDB.setSupportStatus(id, $("#caseStatus").value);
        closeModal();
        toast("Reply sent", "The thread is updated", "ok");
        loadMyCases(); if (asAdmin) loadAdmin();
      } catch { toast("Could not send", "Please try again", "warn"); }
    });
  }

  /* Admin — super admins only. The nav button is hidden for everyone else;
     this guard also keeps subscriber/case data from loading at all. */
  let adminVerified = false;
  async function loadAdmin() {
    if (!window.SHDB) return;
    if (!adminVerified) {
      const ok = await SHDB.isSystemAdmin().catch(() => false);
      if (!ok) { const nav = $("#navAdmin"); if (nav) nav.hidden = true; return; }
      adminVerified = true;
    }
    try {
      const [subs, cases, errors] = await Promise.all([SHDB.adminSubscribers(), SHDB.listSupportCases(), SHDB.adminErrors().catch(() => [])]);
      tenantNames = {};
      (subs || []).forEach((t) => { tenantNames[t.id] = t.name; });
      $("#admSubs").textContent = (subs || []).length;
      $("#admActive").textContent = (subs || []).filter((t) => t.subscription_status === "active" || t.subscription_status === "trialing").length;
      $("#admOpen").textContent = (cases || []).filter((c) => c.status === "open" || c.status === "pending").length;
      $("#subsTable tbody").innerHTML = (subs || []).map((t) => `
        <tr style="cursor:default"><td class="guest"><strong>${esc(t.name)}</strong><span>${esc(t.id.slice(0, 8))}…</span></td>
          <td class="mono">${esc(t.slug)}</td><td>${esc(t.contact_email || "-")}</td>
          <td>${esc(SITE.priceLabel)}/mo</td><td><span class="pill ${t.subscription_status === "active" ? "clean" : t.subscription_status === "past_due" ? "dirty" : "progress"}"><i></i>${esc(t.subscription_status)}</span></td>
          <td>${t.current_period_end ? new Date(t.current_period_end).toLocaleDateString() : "-"}</td>
          <td>${new Date(t.created_at).toLocaleDateString()}</td></tr>`).join("");
      $("#adminCasesTable tbody").innerHTML = (cases || []).map((c) => `
        <tr data-case="${c.id}"><td class="guest"><strong>${esc(c.subject)}</strong><span>${esc(c.id.slice(0, 8))}…</span></td>
          <td>${esc(tenantNames[c.tenant_id] || "Unknown")}</td><td>${esc(c.requester_email || "-")}</td>
          <td>${esc(c.category)}</td><td><span class="pill ${statusPill(c.status)}"><i></i>${esc(c.status)}</span></td>
          <td>${new Date(c.updated_at).toLocaleDateString()}</td></tr>`).join("");
      $("#adminErrorsTable tbody").innerHTML = (errors || []).map((e) => `
        <tr style="cursor:default"><td class="guest"><strong>${esc(e.message)}</strong><span class="mono">${esc(e.source || e.url || "")}</span></td>
          <td>${e.page === "server" ? "Server" : esc(e.page)}</td><td>${esc(tenantNames[e.tenant_id] || "-")}</td>
          <td class="num">${Number(e.count) || 1}</td><td>${new Date(e.last_seen).toLocaleString()}</td></tr>`).join("") ||
        `<tr><td colspan="5"><div class="empty">No browser errors reported in the last 30 days.</div></td></tr>`;
    } catch { toast("Admin data unavailable", "Apply the admin/support migration first", "warn"); }
  }

  async function checkAdmin() {
    if (!window.SHDB) return;
    try {
      const is = await SHDB.isSystemAdmin();
      adminVerified = !!is;
      const nav = $("#navAdmin");
      if (nav) nav.hidden = !is;
      if (is && location.hash === "#admin") goto("admin", "replace"); // refreshed on System Admin (loads it)
      else if (is) loadAdmin();
    } catch { adminVerified = false; const nav = $("#navAdmin"); if (nav) nav.hidden = true; }
  }

  /* Billing (Stripe Checkout via Edge Function) */
  /* Wire */
  function applySupportGate() {
    if (!isDemo()) return;
    ["#chatInput", "#chatAsk", "#caseFromChat", "#suggestBtn", "#caseSubject", "#caseCategory", "#casePriority", "#caseBody", "#createCaseBtn"]
      .forEach((s) => { const el = $(s); if (el) el.disabled = true; });
    document.querySelectorAll("[data-prompt]").forEach((b) => { b.disabled = true; });
    const notice = $("#supportDemoNotice");
    if (notice) notice.hidden = false;
    const input = $("#chatInput");
    if (input) input.placeholder = "Sign in to ask Spark";
  }
  applySupportGate();
  bubble("ai", "Hi, I am Spark", `Ask me how to do anything in ${SITE.name}, like adding a cabin, charging a guest, or embedding booking on your website. If I cannot solve it, I will help you open a case for our team.`);
  $("#chatAsk").addEventListener("click", () => askSpark($("#chatInput").value));
  $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") askSpark(e.target.value); });
  document.querySelectorAll("[data-prompt]").forEach((b) => b.addEventListener("click", () => askSpark(b.dataset.prompt)));
  $("#caseFromChat").addEventListener("click", () => {
    if (lastQuestion) { $("#caseSubject").value = lastQuestion.slice(0, 80); $("#caseBody").value = "From Spark chat: " + lastQuestion; }
    $("#caseSubject").focus();
    toast("Case drafted", "Add any detail, then Create case", "");
  });
  $("#suggestBtn").addEventListener("click", () => {
    $("#caseCategory").value = "feature";
    $("#caseSubject").value = "Suggestion: ";
    $("#caseSubject").focus();
    toast("Love it", `Tell us what would make ${SITE.name} better`, "");
  });
  $("#createCaseBtn").addEventListener("click", async () => {
    if (isDemo()) { toast("Support needs an account", "Exit the demo and sign in to open a case", "warn"); return; }
    const subject = $("#caseSubject").value.trim();
    const body = $("#caseBody").value.trim();
    if (!subject || !body) { toast("Add a subject and a few details", "So the team can help fast", "warn"); return; }
    if (!window.SHDB || !SHDB.hasLive()) { toast("Sign in to open a case", "Cases are tied to your property", "warn"); return; }
    try {
      await SHDB.createSupportCase({ subject, category: $("#caseCategory").value, priority: $("#casePriority").value, body, email: myEmail() });
      $("#caseSubject").value = ""; $("#caseBody").value = "";
      toast("Case created", "Our team can see it now and will reply here", "ok");
      loadMyCases();
    } catch { toast("Could not create the case", "Apply the support migration (20261028000000), then retry", "warn"); }
  });
  $("#myCases").addEventListener("click", (e) => {
    const row = e.target.closest("[data-case]");
    if (row) openCase(row.dataset.case, false);
  });
  $("#adminCasesTable").addEventListener("click", (e) => {
    const row = e.target.closest("[data-case]");
    if (row) openCase(row.dataset.case, true);
  });
  const refresh = $("#adminRefresh");
  if (refresh) refresh.addEventListener("click", loadAdmin);
  document.addEventListener("click", (e) => {
    const act = e.target.closest("[data-action]");
    if (act && act.dataset.action === "billing-help") { goto("support"); $("#caseCategory").value = "billing"; }
  });
  // Any way onto these screens (nav, buttons, Back/Forward, a refresh) loads them.
  window.addEventListener("sh-view", (e) => {
    const view = e.detail && e.detail.view;
    if (view === "support") loadMyCases();
    if (view === "admin") loadAdmin();
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto-view]");
    if (b && typeof goto === "function") goto(b.dataset.gotoView);
  });
  window.addEventListener("sh-auth", () => { checkAdmin(); loadMyCases(); });
  checkAdmin();
  loadMyCases();
})();
