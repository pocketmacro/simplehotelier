// Focused test: Cloudflare Turnstile on public bookings.
// Risk covered: bots could call create_booking() straight from PostgREST and
// fill a property's calendar with fake holds. Now the booking page sends a
// one-time Turnstile token to the create-booking Edge Function, which checks
// it with Siteverify (success + action + our hostname, failing closed) before
// it calls create_booking() with the service role; browsers lose direct access.
// Run: node --test tests/turnstile.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const fn = read("supabase/functions/create-booking/index.ts");
const book = read("js/book.js");
const html = read("book.html");
const config = read("js/config.js");
const headers = read("_headers");
const part1 = read("supabase/migrations/20261120000000_booking_turnstile.sql");
const part2 = read("supabase/migrations/20261120000100_booking_turnstile_lockdown.sql");

// ------------------------------------------------------------ Edge Function
test("create-booking verifies the token with Siteverify before booking", () => {
  assert.match(fn, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(fn, /Deno\.env\.get\("TURNSTILE_SECRET"\)/, "secret from function secrets only");
  assert.match(fn, /result\.success === true && result\.action === ACTION && hostAllowed\(result\.hostname\)/);
  assert.match(fn, /const ACTION = "booking"/);
  assert.match(fn, /token\.length === 0 \|\| token\.length > 2048/);
  assert.match(fn, /AbortSignal\.timeout\(10_000\)/);
  assert.ok(fn.indexOf("await verified(") < fn.indexOf('admin.rpc("create_booking"'), "verify first, then book");
  assert.match(fn, /if \(!\(await verified\(body\.turnstile_token, ip\)\)\) return refuse\(\);/);
});

test("create-booking fails closed when Siteverify is unreachable or the secret is missing", () => {
  assert.match(fn, /if \(!secret \|\| typeof token !== "string"/);
  assert.match(fn, /catch \(e\) \{\s*console\.error\("create-booking: siteverify unavailable", e\); \/\/ fail closed\s*return false;/);
  assert.match(fn, /if \(!r\.ok\) throw new Error/);
});

test("create-booking accepts only our own hostnames (never localhost in production)", () => {
  const body = fn.slice(fn.indexOf("function hostAllowed"), fn.indexOf("const json ="));
  assert.doesNotMatch(body, /localhost|127\.0\.0\.1/);
  assert.match(body, /h === "simplehotelier\.com" \|\| h\.endsWith\("\.simplehotelier\.com"\)/);
});

test("create-booking passes only the booking fields and the guest IP", () => {
  assert.match(fn, /for \(const k of PARAMS\) if \(input\[k\] !== undefined\) args\[k\] = input\[k\];/);
  const params = fn.match(/const PARAMS = \[([\s\S]*?)\];/)[1];
  assert.doesNotMatch(params, /p_client_ip|cents|paid|status|confirmation/, "the browser can't set the IP, prices, or codes");
  assert.match(fn, /\{ p_client_ip: ip \|\| null \}/);
});

test("create-booking never logs the token or secret", () => {
  for (const line of fn.split("\n").filter((l) => /console\./.test(l))) {
    assert.doesNotMatch(line, /token\b|secret/i, line.trim());
  }
});

// ------------------------------------------------------------ booking page
test("booking page renders Turnstile explicitly and sends its token with the booking", () => {
  assert.match(book, /turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(book, /action: "booking"/);
  assert.match(book, /appearance: "interaction-only"/);
  assert.match(book, /sitekey: cfg\.TURNSTILE_SITE_KEY/);
  assert.match(book, /const turnstileToken = await takeToken\(\);/);
  assert.match(book, /fnPost\("create-booking", \{\s*turnstile_token: turnstileToken,\s*booking: \{/);
  assert.doesNotMatch(book, /rpc\/create_booking/, "no direct RPC path left");
  assert.match(html, /<div class="bk-turnstile" id="tsWidget"><\/div>/);
});

test("tokens are single-use: taken once and the widget resets after a failed try", () => {
  assert.match(book, /const token = ts\.token;\s*ts\.token = "";\s*return token;/);
  assert.match(book, /catch \(e\) \{\s*resetTurnstile\(\);/);
  assert.match(book, /window\.turnstile\.reset\(ts\.id\)/);
});

test("the studio preview never loads Turnstile", () => {
  assert.match(book, /const tsReady = isPreview \|\| !cfg\.TURNSTILE_SITE_KEY \? Promise\.resolve\(false\)/);
});

test("config ships only the public sitekey", () => {
  assert.match(config, /TURNSTILE_SITE_KEY: "0x4[A-Za-z0-9_-]+"/);
  assert.doesNotMatch(config, /TURNSTILE_SECRET|0x4AAAAAA[A-Za-z0-9_-]{30,}/, "no secret key in the browser");
});

test("booking page CSP allows the Turnstile script and frame", () => {
  const book = headers.split(/\n(?=\/)/).find((block) => block.startsWith("/book\n")) || "";
  const csp = (book.match(/Content-Security-Policy: (.+)/) || [])[1] || "";
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
});

// ------------------------------------------------------------ database
test("create_booking trusts a passed IP only from the service role", () => {
  assert.match(part1, /p_client_ip text default null/);
  assert.match(part1, /if p_client_ip is not null and coalesce\(auth\.role\(\), ''\) = 'service_role' then/);
  assert.match(part1, /v_ip := left\(btrim\(p_client_ip\), 64\);/);
  assert.match(part1, /drop function if exists public\.create_booking\(uuid, date, date, text, text, uuid, uuid, int, text, text, uuid\[\], text, boolean, boolean\);/, "old signature gone");
});

test("lockdown removes the direct browser path to create_booking", () => {
  const sig = "uuid, date, date, text, text, uuid, uuid, int, text, text, uuid\\[\\], text, boolean, boolean, text";
  assert.match(part2, new RegExp(`revoke execute on function public\\.create_booking\\(${sig}\\) from public, anon, authenticated;`));
  assert.match(part2, new RegExp(`grant execute on function public\\.create_booking\\(${sig}\\) to service_role;`));
});
