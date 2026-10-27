// Focused tests: security hotfix (20261115000000 + 20261115000100).
// Risks covered: (1) stored XSS — anon-chosen confirmation codes rendered
// unescaped in the dashboard; (2) guests setting their own price/paid amount
// and holding unlimited inventory via direct inserts; (3) promo codes readable
// by anyone; (4) unauthenticated Stripe Connect onboarding links and
// browser-chosen deposit amounts; (5) phishing links in invite emails built
// from the caller's Origin header; (6) SSRF through iCal feed URLs;
// (7) membership takeover and billing bypass through RLS.
// Run: node --test tests/security-hotfix.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { safeOrigin, feedUrlProblem } from "../supabase/functions/_shared/origin.js";
import { syncFeed } from "../supabase/functions/_shared/sync.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const book = read("js/book.js");
const part1 = read("supabase/migrations/20261115000000_security_hotfix.sql");
const part2 = read("supabase/migrations/20261115000100_public_booking_lockdown.sql");
const fn = (name) => read(`supabase/functions/${name}/index.ts`);

globalThis.window = { SH_CONFIG: {} };
globalThis.document = { querySelector: () => null, addEventListener: () => {} };
globalThis.location = { search: "", protocol: "https:", origin: "https://example.com", hostname: "example.com" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
eval(book);
const { safeUrl, bookingErrorText } = window.SHBookCalc;

// ---------------------------------------------------------------- dashboard XSS
test("dashboard escapes confirmation codes, room codes and room labels in HTML", () => {
  assert.doesNotMatch(app, /["'>]\$\{r\.(ref|code|room)\}/, "raw ${r.ref|code|room} in an HTML context");
  assert.match(app, /<td class="mono">\$\{esc\(r\.ref\)\}<\/td>/);
});

test("every dashboard upload lands in the tenant's own storage folder", () => {
  const calls = app.match(/uploadPublic\("[a-z-]+", `[^`]*`/g) || [];
  assert.ok(calls.length >= 5, "expected the logo, hero, room, type and ticket uploads");
  for (const c of calls) assert.match(c, /`\$\{SHDB\.tenantId\(\)\}\//, c);
});

test("front-desk reservation codes are random, not a per-device counter", () => {
  assert.doesNotMatch(app, /"R-" \+ \(1053/);
  assert.match(app, /newRef\("R-"\)/);
});

// ---------------------------------------------------------------- booking page
test("booking page books only through create_booking and never posts money fields", () => {
  assert.match(book, /rpc\/create_booking/);
  assert.doesNotMatch(book, /api\("reservations"/, "no direct reservation inserts");
  assert.doesNotMatch(book, /api\("reservation_addons"/, "no direct add-on inserts");
  assert.doesNotMatch(book, /total_cents:|paid_cents:|confirmation_code:/, "server prices and codes the booking");
  assert.doesNotMatch(book, /amount_cents:/, "deposit amount comes from charge-guest, not the browser");
});

test("booking page never reads rate_plans directly (promo codes stay private)", () => {
  assert.doesNotMatch(book, /room_types\?[^"]*select=\*/);
  assert.match(book, /rpc\/get_rate_plans/);
  const cols = (book.match(/const TYPE_COLS = "([^"]+)"/) || [])[1] || "";
  assert.ok(cols && !cols.split(",").includes("rate_plans"));
});

test("owner-entered links are web URLs only", () => {
  assert.equal(safeUrl("https://pinecrest.example/"), "https://pinecrest.example/");
  assert.equal(safeUrl("http://pinecrest.example/"), "http://pinecrest.example/");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>1</script>"), "");
  assert.equal(safeUrl("not a url"), "");
  assert.equal(safeUrl("http://x.example/a.jpg", { httpsOnly: true }), "");
});

test("guests see the server's sentence for known booking errors, a generic line otherwise", () => {
  assert.equal(bookingErrorText({ code: "unavailable", details: "Those dates just became unavailable." }), "Those dates just became unavailable.");
  assert.match(bookingErrorText({ code: "Supabase 500", details: "internal stack" }), /Something went wrong/);
  assert.match(bookingErrorText(new Error("network")), /Something went wrong/);
});

// ---------------------------------------------------------------- link origins
test("generated links only use our own origins", () => {
  const site = "https://simplehotelier.com";
  assert.equal(safeOrigin("https://evil.example", { site }), site);
  assert.equal(safeOrigin("https://simplehotelier.com.evil.example", { site }), site);
  assert.equal(safeOrigin("http://simplehotelier.com", { site }), site, "plain http is not ours");
  assert.equal(safeOrigin("https://pinecrest.simplehotelier.com", { site }), "https://pinecrest.simplehotelier.com");
  assert.equal(safeOrigin("http://localhost:8000", { site }), "http://localhost:8000");
  assert.equal(safeOrigin("https://preview.pages.dev", { site, extra: ["https://preview.pages.dev"] }), "https://preview.pages.dev");
  assert.equal(safeOrigin(null, { site }), site);
  assert.equal(safeOrigin("garbage", { site }), site);
});

// ---------------------------------------------------------------- iCal SSRF
test("feed URLs must be public https web addresses", () => {
  assert.equal(feedUrlProblem("https://www.airbnb.com/calendar/ical/123.ics?s=abc"), "");
  assert.notEqual(feedUrlProblem("http://www.airbnb.com/calendar/ical/123.ics"), "");
  assert.notEqual(feedUrlProblem("https://169.254.169.254/latest/meta-data"), "");
  assert.notEqual(feedUrlProblem("https://127.0.0.1/x.ics"), "");
  assert.notEqual(feedUrlProblem("https://[::1]/x.ics"), "");
  assert.notEqual(feedUrlProblem("https://localhost/x.ics"), "");
  assert.notEqual(feedUrlProblem("https://db.internal/x.ics"), "");
  assert.notEqual(feedUrlProblem("https://user:pw@www.airbnb.com/x.ics"), "");
  assert.notEqual(feedUrlProblem("https://www.airbnb.com:8443/x.ics"), "");
  assert.notEqual(feedUrlProblem("file:///etc/passwd"), "");
});

function fakeAdmin() {
  const updates = [];
  const chain = {
    update(row) { updates.push(row); return chain; },
    delete() { return chain; },
    insert: async () => ({ error: null }),
    eq() { return chain; },
    gte() { return chain; },
    then(resolve) { resolve({ error: null }); }
  };
  return { updates, from: () => chain };
}
const ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a@x\r\nDTSTART;VALUE=DATE:20991201\r\nDTEND;VALUE=DATE:20991203\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null });

test("syncFeed refuses internal URLs without fetching them", async () => {
  const admin = fakeAdmin();
  let fetched = 0;
  const r = await syncFeed(admin, { id: "f1", url: "https://169.254.169.254/latest", tenant_id: "t", room_id: "r" }, async () => { fetched++; });
  assert.equal(fetched, 0);
  assert.match(r.error, /IP/);
  assert.match(admin.updates[0].last_error, /IP/);
});

test("syncFeed re-checks every redirect hop", async () => {
  const seen = [];
  const r = await syncFeed(fakeAdmin(), { id: "f1", url: "https://www.airbnb.com/cal.ics", tenant_id: "t", room_id: "r" }, async (url) => {
    seen.push(url);
    return { status: 302, ok: false, headers: headers({ location: "http://10.0.0.5/secret" }) };
  });
  assert.deepEqual(seen, ["https://www.airbnb.com/cal.ics"]);
  assert.match(r.error, /https/);
});

test("syncFeed caps the feed size", async () => {
  const r = await syncFeed(fakeAdmin(), { id: "f1", url: "https://www.airbnb.com/cal.ics", tenant_id: "t", room_id: "r" }, async () => ({
    status: 200, ok: true, headers: headers({ "content-length": "50000000" }), text: async () => ICS
  }));
  assert.match(r.error, /too large/);
});

test("syncFeed still imports a normal feed", async () => {
  const r = await syncFeed(fakeAdmin(), { id: "f1", url: "https://www.airbnb.com/cal.ics", tenant_id: "t", room_id: "r" }, async () => ({
    status: 200, ok: true, headers: headers({}), text: async () => ICS
  }));
  assert.equal(r.error, undefined);
  assert.equal(r.imported, 1);
});

// ---------------------------------------------------------------- Edge Functions
test("stripe-connect requires a signed-in member, and owner/admin for onboarding links", () => {
  const src = fn("stripe-connect");
  const userAt = src.indexOf("callerUser(admin, req)");
  assert.ok(userAt > 0 && userAt < src.indexOf("stripe.accounts"), "auth before any Stripe call");
  assert.match(src, /memberRole\(admin/);
  assert.match(src, /role !== "owner" && role !== "admin"/);
  assert.match(src, /appOrigin\(req\.headers\.get\("origin"\)\)/);
});

test("charge-guest computes the deposit server-side and records payments atomically", () => {
  const src = fn("charge-guest");
  assert.doesNotMatch(src, /body\.amount_cents|amount_cents \}\s*=\s*body|const \{[^}]*amount_cents[^}]*\} = body/);
  assert.match(src, /deposit_percent/);
  assert.match(src, /resv\.status !== "pending"/);
  assert.match(src, /rpc\("record_stripe_payment"/);
  assert.match(src, /intent\.metadata\?\.tenant_id !== tenant\.id/);
  assert.match(fn("stripe-webhook"), /rpc\("record_stripe_payment"/);
});

test("emails escape guest/owner text and invite links never trust the Origin header", () => {
  const send = fn("send-email");
  assert.doesNotMatch(send, /req\.headers\.get\("origin"\) \|\|/);
  assert.match(send, /appOrigin\(req\.headers\.get\("origin"\)\)/);
  assert.match(send, /<strong>\$\{esc\(r\.guest_name\)\}<\/strong>/);
  assert.match(send, /myRole !== "owner" && myRole !== "admin"/);
  assert.match(send, /\.is\("confirmation_email_sent_at", null\)/, "one confirmation per reservation");
  assert.doesNotMatch(fn("daily-jobs"), /<strong>\$\{(property|t\.name)\}<\/strong>/);
  assert.match(read("supabase/functions/_shared/email.ts"), /export const esc/);
});

test("accept-invite needs a confirmed email and never changes an existing role", () => {
  const src = fn("accept-invite");
  assert.match(src, /email_confirmed_at/);
  assert.match(src, /ignoreDuplicates: true/);
  assert.match(src, /INVITE_TTL_DAYS/);
});

test("Edge Functions do not return raw exception messages", () => {
  for (const name of readdirSync(new URL("../supabase/functions/", import.meta.url)).filter((n) => !n.startsWith("_") && !n.endsWith(".md"))) {
    if (name === "stripe-webhook") continue; // Stripe-only caller; signature verified first
    assert.doesNotMatch(fn(name), /error: e\.message/, name);
  }
});

// ---------------------------------------------------------------- migrations
test("part 1 closes membership takeover and billing bypass", () => {
  assert.match(part1, /drop policy if exists members_self_insert/);
  assert.match(part1, /drop policy if exists members_owner_manage/);
  assert.match(part1, /public\.can_claim_tenant\(tenant_id\)/);
  assert.match(part1, /drop policy if exists tenants_member_all/);
  assert.match(part1, /tenants_manager_update[\s\S]*has_tenant_role\(id, array\['owner', 'admin'\]\)/);
  for (const col of ["subscription_status", "stripe_account_id", "stripe_customer_id", "plan_price_cents", "current_period_end"]) {
    assert.match(part1, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
  }
  assert.match(part1, /current_user not in \('anon', 'authenticated'\)/);
});

test("part 1 keeps internal functions away from browsers", () => {
  assert.match(part1, /revoke execute on function public\.quote_stay\([^)]*\) from public, anon, authenticated/);
  assert.match(part1, /revoke execute on function public\.record_stripe_payment\(text\) from public, anon, authenticated/);
  assert.match(part1, /grant execute on function public\.create_booking\([^)]*\) to anon, authenticated/);
  assert.match(part1, /reservations_confirmation_code_format/);
});

test("part 1 SQL never relies on the jsonb ? operator (Management API placeholders)", () => {
  const code = part1.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\s\?\s'/);
});

test("part 2 removes anonymous inserts, hides rate_plans, scopes storage", () => {
  assert.match(part2, /drop policy if exists reservations_public_request/);
  assert.match(part2, /revoke insert on public\.reservations from anon/);
  assert.match(part2, /drop policy if exists reservation_addons_public_insert/);
  assert.match(part2, /column_name <> 'rate_plans'/);
  assert.match(part2, /drop policy if exists storage_auth_update/);
  assert.match(part2, /storage\.foldername\(name\)\)\[1\] in \(select m::text from public\.member_tenant_ids\(\) m\)/);
});

test("migration files use LF line endings", () => {
  for (const f of [part1, part2]) assert.ok(!f.includes("\r"));
});
