// Focused test: the basics a paying customer expects.
// Risks covered: (1) the reservations CSV had day offsets ("4", "-2") instead
// of dates, and guest-typed names could run as spreadsheet formulas; (2)
// owners couldn't cancel, change their card or see invoices, and "Subscribe
// or renew" could start a second subscription or a fresh trial each time;
// (3) no Terms of Service or Privacy Policy; (4) guests heard nothing when the
// property cancelled, confirmed their request or moved their dates.
// Run: node --test tests/basics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const rxjs = read("js/reservation.js");
const support = read("js/support.js");
const checkout = read("supabase/functions/create-checkout/index.ts");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const email = read("supabase/functions/send-email/index.ts");
const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
// The platform config as the browser gets it (js/site.js).
const SITE = new Function("window", read("js/site.js") + "\nreturn window.SH_SITE;")({});

/* ------------------------------------------------------------ CSV export */
test("reservation export has real dates, contact columns and a dated filename", () => {
  const block = slice(app, 'else if (a === "export") {', 'else if (a === "room-types")');
  assert.doesNotMatch(block, /"Check-in offset"/);
  assert.match(block, /"Check-in", "Check-out", "Nights"/);
  assert.match(block, /day\(r\.checkIn, r\.inN\), day\(r\.checkOut, r\.outN\)/, "live dates, demo offsets turned into dates");
  assert.match(block, /`\$\{fileStem\(\)\}-reservations-\$\{stamp\}\.csv`/);
  const stem = (site) => new Function("SITE", "return " + app.match(/const fileStem = ([^\n]+);/)[1])(site)();
  assert.equal(stem(SITE), "simplehotelier", "named after the platform (site.config.json)");
  assert.equal(stem({ name: "Lakeside Stays & Co" }), "lakeside-stays-co");
  assert.match(block, /"\\uFEFF" \+/, "BOM so Excel reads UTF-8");
});

test("CSV cells can't smuggle spreadsheet formulas; negative amounts stay numbers", () => {
  const src = slice(app, "const csvCell = (v) => {", "const stamp");
  const csvCell = new Function(src + "\nreturn csvCell;")();
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  for (const bad of ["+1+1", "-1+cmd", "@SUM(A1)"]) assert.ok(csvCell(bad).startsWith(`"'`), bad);
  assert.equal(csvCell("-155.00"), `"-155.00"`);
  assert.equal(csvCell("Lucía Fernández"), `"Lucía Fernández"`);
  assert.equal(csvCell(3), `"3"`);
});

/* ------------------------------------------------------------ billing */
test("owners open Stripe's billing portal to change card, see invoices or cancel", () => {
  assert.match(checkout, /if \(action === "portal"\) \{/);
  assert.match(checkout, /billingPortal\.sessions\.create\(\{\s+customer: tenant\.stripe_customer_id,/);
  assert.match(checkout, /mode: "at_period_end"/, "cancel keeps access to the end of the period");
  assert.match(checkout, /invoice_history: \{ enabled: true \}/);
  assert.match(checkout, /payment_method_update: \{ enabled: true \}/);
  assert.match(checkout, /privacy_policy_url: SITE_URL \+ "\/privacy",\s+terms_of_service_url: SITE_URL \+ "\/terms"/);
  assert.match(checkout, /member\.role !== "owner" && member\.role !== "admin"/, "billing stays owner/admin only");
});

test("no second subscription, and the free trial is for the first one only", () => {
  assert.match(checkout, /if \(hasLiveSub\) return json\(\{ error: "This property already has a subscription", portal: true \}, 409\);/);
  assert.match(checkout, /\.\.\.\(tenant\.stripe_subscription_id \? \{\} : \{ trial_period_days: SITE\.plan\.trialDays \}\)/);
  assert.match(app, /if \(d\.portal\) \{ openBilling\("portal"\); return; \}/, "the dashboard opens the portal instead");
});

test("the webhook records when a cancelled plan stops, and only it can", () => {
  assert.match(webhook, /subscription_cancel_at: event\.type\.endsWith\("deleted"\) \? null : cancelAt\(sub\)/);
  const cancelAt = new Function(slice(webhook, "function cancelAt(", "function mapStatus(").replace(/: any/g, "") + "\nreturn cancelAt;")();
  assert.equal(cancelAt({ cancel_at_period_end: true, current_period_end: 1767225600 }), "2026-01-01T00:00:00.000Z");
  assert.equal(cancelAt({ cancel_at: 1767225600 }), "2026-01-01T00:00:00.000Z");
  assert.equal(cancelAt({ cancel_at_period_end: false, current_period_end: 1767225600 }), null);
  const sql = read("supabase/migrations/20261129000000_billing_portal.sql");
  assert.match(sql, /add column if not exists subscription_cancel_at timestamptz/);
  assert.match(sql, /new\.subscription_cancel_at is distinct from old\.subscription_cancel_at then\s+raise exception/);
});

function billingCard(t) {
  const els = {};
  const $ = (sel) => (els[sel] ||= { textContent: "", innerHTML: "", hidden: false });
  const pill = ([cls, label]) => `<span class="pill ${cls}">${label}</span>`;
  const planPrice = () => `${SITE.priceLabel}/month`;
  new Function("$", "pill", "SITE", "planPrice", slice(app, "const BILL_STATUS = {", "let checkoutToastShown") + "\nrenderBilling(arguments[4]);")($, pill, SITE, planPrice, t);
  return { status: els["#billStatus"].innerHTML, label: els["#billPeriodLabel"].textContent, period: els["#billPeriod"].textContent,
    note: els["#billNote"].textContent, checkout: els["#billCheckout"].hidden ? null : els["#billCheckout"].textContent, portal: !els["#billPortal"].hidden };
}

test("Settings shows the plan in plain words with the right buttons", () => {
  const fresh = billingCard({ subscription_status: "trialing" }); // never checked out
  assert.match(fresh.status, /Not started/);
  assert.equal(fresh.checkout, "Start 30-day free trial");
  assert.equal(fresh.portal, false);

  const trial = billingCard({ subscription_status: "trialing", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", current_period_end: "2026-11-26T12:00:00Z" });
  assert.match(trial.status, /Free trial/);
  assert.equal(trial.label, "Trial ends");
  assert.equal(trial.checkout, null, "no second checkout while subscribed");
  assert.equal(trial.portal, true);

  const ending = billingCard({ subscription_status: "active", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1", subscription_cancel_at: "2026-11-26T12:00:00Z" });
  assert.match(ending.status, /Cancels Nov 26, 2026/);
  assert.equal(ending.label, "Ends");
  assert.match(ending.note, /Renew it in Manage billing/);

  const failed = billingCard({ subscription_status: "past_due", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
  assert.match(failed.note, /Update your card/);

  const over = billingCard({ subscription_status: "canceled", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" });
  assert.equal(over.checkout, "Subscribe again");
  assert.equal(over.portal, true, "old invoices stay reachable");
});

test("one billing handler, one checkout toast, and the return URL is cleaned", () => {
  assert.doesNotMatch(support, /startCheckout|billing-checkout/);
  assert.doesNotMatch(support, /Welcome aboard/);
  assert.match(app, /else if \(a === "billing-portal"\) openBilling\("portal"\);/);
  assert.match(app, /if \(co \|\| qs\.get\("billing"\)\) \{[^}]+history\.replaceState/);
});

/* ------------------------------------------------------------ legal pages */
test("Terms and Privacy exist, name a working contact and the real providers", () => {
  for (const page of ["terms.html", "privacy.html"]) {
    assert.ok(existsSync(new URL("../" + page, import.meta.url)), page);
    const html = read(page);
    assert.match(html, /support@simplehotelier\.com/, page);
    assert.match(html, /<link rel="canonical" href="https:\/\/simplehotelier\.com\/(terms|privacy)">/);
  }
  const privacy = read("privacy.html");
  for (const provider of ["Supabase", "Cloudflare", "Stripe", "Amazon", "Meta", "Google"]) assert.match(privacy, new RegExp(provider), provider);
  assert.match(read("terms.html"), /Settings → Plan and billing → Manage billing/, "how to cancel online");
});

test("the legal pages are linked from the site, sign-up and booking pages", () => {
  assert.match(read("index.html"), /<a href="terms\.html">Terms<\/a>\s+<a href="privacy\.html">Privacy<\/a>/);
  assert.match(read("app.html"), /By creating an account, you agree to the <a href="terms\.html"[^>]*>Terms of Service<\/a> and <a href="privacy\.html"/);
  assert.match(read("book.html"), /<a href="https:\/\/simplehotelier\.com\/privacy"/);
  const sitemap = read("sitemap.xml");
  assert.match(sitemap, /simplehotelier\.com\/terms</);
  assert.match(sitemap, /simplehotelier\.com\/privacy</);
});

/* ------------------------------------------------------------ guest emails */
function news(row, form, override) {
  const rx = { row, form: { email: "g@example.com", checkIn: "2026-11-01", checkOut: "2026-11-03", roomCode: "A1", status: "confirmed", ...form } };
  const roomByCode = (c) => ({ A1: { id: "r1" }, B2: { id: "r2" } })[c];
  const rxStatusDb = (s) => ({ "checked-in": "checked_in", "checked-out": "checked_out" }[s] || s);
  const fn = new Function("rx", "rxLive", "roomByCode", "rxStatusDb", slice(rxjs, "function rxGuestNews(", "async function rxTellGuest(") + "\nreturn rxGuestNews;");
  return fn(rx, () => true, roomByCode, rxStatusDb)(override);
}
const saved = { status: "confirmed", check_in: "2026-11-01", check_out: "2026-11-03", room_id: "r1" };

test("the editor offers to email the guest only when there's news for them", () => {
  assert.equal(news(saved, {}), null, "nothing changed");
  assert.equal(news(saved, { notes: "late arrival" }), null, "other edits stay quiet");
  assert.equal(news(saved, {}, "cancelled"), "cancelled");
  assert.equal(news(saved, { checkOut: "2026-11-04" }), "changed");
  assert.equal(news(saved, { roomCode: "B2" }), "changed");
  assert.equal(news({ ...saved, status: "pending" }, {}), "confirmed", "a request accepted");
  assert.equal(news({ ...saved, status: "cancelled" }, {}), "confirmed", "reinstated");
  assert.equal(news({ ...saved, status: "cancelled" }, { status: "cancelled" }), null);
  assert.equal(news(saved, { status: "checked-in", checkOut: "2026-11-05" }), "changed", "stay extended while in house");
  assert.equal(news(saved, { email: " " }, "cancelled"), null, "no email address");
  assert.equal(news(null, {}), null, "new bookings use the confirmation email");
});

test("the email goes out after a successful save, and staff can opt out", () => {
  assert.match(rxjs, /const news = f\.notify === false \? null : rxGuestNews\(\);/);
  assert.match(rxjs, /rxRender\(\);\s+if \(news\) rxTellGuest\(news, row\);/);
  assert.match(rxjs, /data-rx-field="notify"/);
  assert.match(app, /if \(to === "confirmed" && live && r\.email\) \{\s+fnInvoke\("send-email", \{ action: "booking_confirmation", reservation_id: r\.id, force: true \}\)/, "quick confirm emails the guest");
});

test("booking_update is front-desk only and must match the saved booking", () => {
  const route = slice(email, 'if (body.action === "booking_update"', 'if (body.action === "team_invite")');
  assert.match(route, /\["cancelled", "changed"\]\.includes\(body\.change\)/);
  assert.match(route, /\["owner", "admin", "staff"\]\.includes\(role\)/);
  assert.match(email, /if \(\(change === "cancelled"\) !== \(r\.status === "cancelled"\)\) return json\(\{ sent: false, reason: "booking status doesn't match" \}, 409\);/);
  assert.match(email, /fromName: brand\.name,\s+replyTo: brand\.replyTo\s+\}\);\s+return json\(\{ sent: res\.sent \}\);/, "sent as the property; guests reply to it");
});
