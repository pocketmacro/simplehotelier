// Focused test: production hardening, part 3.
// Risks covered: (1) every amount showed "$" whatever the property's
// currency; (2) PostgREST silently stops at 1000 rows, so a busy property's
// dashboard lost its newest bookings and the daily jobs skipped tenants,
// reminders and feeds past their hard limits; (3) browser errors were
// invisible — nothing reported what guests and owners actually hit.
// Run: node --test tests/hardening-3.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const appHtml = read("app.html");
const book = read("js/book.js");
const bookHtml = read("book.html");
const db = read("js/db.js");
const resv = read("js/reservation.js");
const reporter = read("js/error-report.js");
const support = read("js/support.js");
const sql = read("supabase/migrations/20261121000000_currency_bounds_errors.sql");
const daily = read("supabase/functions/daily-jobs/index.ts");
const icalSync = read("supabase/functions/ical-sync/index.ts");
const icalExport = read("supabase/functions/ical-export/index.ts");

globalThis.window = {};
eval(read("js/money.js"));
const M = window.SHMoney;

// ---------------------------------------------------------------- currency
test("money formats in the property's currency", () => {
  assert.equal(M.format(1234.5, "USD"), "$1,234.50");
  assert.equal(M.format(1234.5, "EUR"), "€1,234.50");
  assert.equal(M.format(1234.5, "GBP"), "£1,234.50");
  assert.equal(M.format(99, "CAD"), "CA$99.00");
  assert.equal(M.format(295, "USD", { short: true }), "$295");
  assert.equal(M.format(14.5, "USD", { short: true }), "$14.50");
  assert.equal(M.format(-5, "USD"), "-$5.00");
  assert.equal(M.format("abc", "USD"), "$0.00");
  assert.equal(M.format(10, "JPY"), "$10.00", "unsupported codes fall back to USD");
  assert.equal(M.format(10, "eur"), "€10.00");
  assert.equal(M.symbol("EUR"), "€");
  assert.equal(M.symbol("USD"), "$");
});

test("the browser and the database allow the same two-decimal currencies", () => {
  const dbList = sql.match(/check \(currency in \(([^)]+)\)\)/)[1].match(/'([A-Z]{3})'/g).map((s) => s.slice(1, 4)).sort();
  assert.deepEqual(Object.keys(M.CURRENCIES).sort(), dbList);
  for (const c of dbList) {
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits;
    assert.equal(digits, 2, `${c} must be a two-decimal currency (amounts are stored in cents)`);
  }
});

test("dashboard and booking page format money through SHMoney", () => {
  assert.match(app, /const money = \(n\) => SHMoney\.format\(n, moneyCurrency\);/);
  assert.match(app, /moneyCurrency = SHMoney\.code\(live\.tenant\.currency\);/);
  assert.match(book, /const money = \(n\) => SHMoney\.format\(n, currency\(\)\);/);
  assert.match(book, /const price = \(n\) => SHMoney\.format\(n, currency\(\), \{ short: true \}\);/);
  for (const [name, src] of [["app.js", app], ["book.js", book], ["reservation.js", resv]]) {
    assert.doesNotMatch(src, /"\$" \+ Number|USD\/night|Amount \(\$\)|Discount \(\$\)/, name);
  }
  assert.doesNotMatch(appHtml, /Minimum room rate \(USD\)/);
});

test("money.js loads before the scripts that use it", () => {
  const order = (html, names) => names.map((n) => html.indexOf(`<script src="js/${n}"`));
  const a = order(appHtml, ["config.js", "error-report.js", "money.js", "app.js", "reservation.js"]);
  assert.ok(a.every((i) => i > 0) && a.every((v, i) => i === 0 || v > a[i - 1]), "app.html script order");
  const b = order(bookHtml, ["config.js", "error-report.js", "money.js", "book.js"]);
  assert.ok(b.every((i) => i > 0) && b.every((v, i) => i === 0 || v > b[i - 1]), "book.html script order");
});

test("currency setting locks after the first payment (UI and database)", () => {
  assert.match(appHtml, /<select class="select" id="pfCurrency"><\/select>/);
  assert.match(app, /setCurrency\(live\.tenant\.currency, \{ locked: !!live\.hasPayments \}\);/);
  assert.match(app, /\$\("#pfCurrency"\) && !\$\("#pfCurrency"\)\.disabled \? \{ currency: SHMoney\.code\(v\("#pfCurrency"\)\) \}/);
  assert.match(app, /e\.code === "currency_locked"/);
  assert.match(sql, /new\.currency is distinct from old\.currency\s+and exists \(select 1 from public\.transactions t where t\.tenant_id = new\.id\)/);
  assert.match(sql, /raise exception 'currency_locked'/);
});

test("tenants_guard keeps every earlier protection", () => {
  const prev = read("supabase/migrations/20261115000000_security_hotfix.sql");
  for (const col of ["stripe_account_id", "stripe_onboarding_complete", "stripe_customer_id", "stripe_subscription_id",
    "subscription_status", "current_period_end", "plan_price_cents", "last_weekly_report_at", "created_by"]) {
    assert.match(sql, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
    assert.match(prev, new RegExp(`new\\.${col}`), col);
  }
  assert.match(sql, /if current_user not in \('anon', 'authenticated'\) then\s+return new;/);
  assert.match(sql, /'stripe'\]\) then/);
  assert.match(sql, /calendar token too short/);
});

// ---------------------------------------------------------------- bounded loads
test("dashboard reads past PostgREST's 1000-row cap and windows reservations", () => {
  assert.match(db, /async function restAll\(path, max = 20000\)/);
  assert.match(db, /path \+ "&limit=" \+ PAGE \+ "&offset=" \+ offset/);
  assert.match(db, /restAll\("reservations\?" \+ tid \+ "&or=\(check_out\.gte\." \+ cutoff \+ ",and\(balance_cents\.gt\.0,status\.neq\.cancelled\)\)&select=\*&order=check_in\.asc,id\.asc"\)/);
  assert.doesNotMatch(db, /rest\("reservations\?" \+ tid \+ "&select=\*&order=check_in\.asc"\)/, "no unbounded reservation load");
  assert.doesNotMatch(db, /transactions\?[^"]*limit=20/, "Collected is no longer the last 20 charges");
  assert.match(appHtml, /Collected · 30 days/);
  assert.match(db, /async function loadOlderReservations\(offset\)/);
  assert.match(appHtml, /id="resOlder" type="button" hidden>Load older reservations/);
  assert.match(sql, /balance_cents int generated always as \(total_cents - paid_cents\) stored/);
});

test("daily jobs and calendar functions page through every row", () => {
  for (const [name, src] of [["daily-jobs", daily], ["ical-sync", icalSync], ["ical-export", icalExport]]) {
    assert.match(src, /import \{ allRows \} from "\.\.\/_shared\/paged\.ts";/, name);
    assert.doesNotMatch(src, /\.limit\(\d+\)/, `${name}: no silent caps`);
  }
  assert.match(daily, /const tenants = await allRows\(\(\) => admin\.from\("tenants"\)\.select\("\*"\)\.order\("id"\)\);/);
  assert.match(daily, /Collect every candidate first/);
  const paged = read("supabase/functions/_shared/paged.ts");
  assert.match(paged, /build\(\)\.range\(from, from \+ pageSize - 1\)/);
});

// ---------------------------------------------------------------- error monitoring
test("browser errors are reported, filtered and capped", () => {
  assert.match(reporter, /\/rest\/v1\/rpc\/log_client_error/);
  assert.match(reporter, /if \(sent >= 5 \|\| seen\.has\(msg\)\) return;/);
  assert.match(reporter, /Script error/);
  assert.match(reporter, /extension:\\\/\\\//);
  assert.match(reporter, /keepalive: true/);
  assert.match(reporter, /p_url: path \+ \(property \? "\?property=" \+ encodeURIComponent\(property\.slice\(0, 63\)\) : ""\)/, "path + property only, never the full query string");
  assert.match(book, /window\.SHReportError\(e, "booking page load"\)/);
  assert.match(db, /window\.SHReportError\(err, "dashboard load"\)/);
});

test("error log: anyone may write (throttled), only system admins read", () => {
  assert.match(sql, /grant execute on function public\.log_client_error\(text, text, text, text, text, uuid\) to anon, authenticated, service_role;/);
  assert.match(sql, /revoke all on public\.client_errors from anon, authenticated;/);
  assert.match(sql, /create policy client_errors_admin_read on public\.client_errors\s+for select to authenticated using \(public\.is_system_admin\(\)\);/);
  assert.match(sql, /revoke all on public\.client_error_hits from anon, authenticated;/);
  assert.match(sql, />= 60 then\s+return;/);
  assert.match(sql, /< 2000\s+on conflict \(day, fingerprint\) do update set count = e\.count \+ 1/);
  assert.match(sql, /revoke execute on function public\.prune_client_errors\(\) from public, anon, authenticated;/);
  assert.match(sql, /cron\.schedule\('simplehotelier-prune-errors'/);
  assert.match(support, /SHDB\.adminErrors\(\)/);
  assert.match(support, /\$\{esc\(e\.message\)\}/, "error text is escaped in the admin table");
});
