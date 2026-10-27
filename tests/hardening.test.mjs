// Focused test: production hardening.
// Risks covered: (1) no security headers / CSP, so any injected script could
// run and the dashboard could be framed (clickjacking); (2) the whole repo —
// migrations, admin scripts, tests — was publicly served; (3) unpinned
// esm.sh imports could change payment code on the next deploy; (4) "*" CORS
// on browser-called functions; (5) unlimited use of the paid AI assistant;
// (6) no CI.
// Run: node --test tests/hardening.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { isOwnOrigin } from "../supabase/functions/_shared/origin.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const headers = read("_headers");
const config = read("js/config.js");
const supabaseUrl = config.match(/SUPABASE_URL: "([^"]+)"/)[1];

/* _headers -> { path: { header: value } } (Cloudflare format). */
function parseHeaders(text) {
  const out = {};
  let cur = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = out[line.trim()] = {}; continue; }
    const i = line.indexOf(":");
    cur[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const rules = parseHeaders(headers);
const csp = (path) => {
  const v = rules[path] && rules[path]["Content-Security-Policy"];
  assert.ok(v, `no CSP for ${path}`);
  return Object.fromEntries(v.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...vals]) => [k, vals]));
};

test("every response gets the baseline security headers", () => {
  const all = rules["/*"];
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.match(all["Strict-Transport-Security"], /max-age=31536000; includeSubDomains/);
  assert.ok(all["Referrer-Policy"] && all["Permissions-Policy"]);
});

test("each page (and its pretty URL) has a CSP; no inline script is allowed anywhere", () => {
  for (const [a, b] of [["/book.html", "/book"], ["/app.html", "/app"], ["/index.html", "/"]]) {
    assert.deepEqual(csp(a), csp(b), `${a} and ${b} must match`);
    const p = csp(a);
    assert.ok(!p["script-src"].includes("'unsafe-inline'") && !p["script-src"].includes("'unsafe-eval'"), `${a}: inline/eval script allowed`);
    assert.deepEqual(p["object-src"], ["'none'"]);
    assert.deepEqual(p["base-uri"], ["'self'"]);
  }
});

test("the dashboard and marketing site cannot be framed; the booking page can (embeds)", () => {
  for (const path of ["/app.html", "/app", "/index.html", "/"]) {
    assert.deepEqual(csp(path)["frame-ancestors"], ["'none'"], path);
    assert.equal(rules[path]["X-Frame-Options"], "DENY", path);
  }
  assert.deepEqual(csp("/book.html")["frame-ancestors"], ["*"]);
  assert.ok(!rules["/book.html"]["X-Frame-Options"], "X-Frame-Options would break embeds");
});

test("CSPs allow exactly what each page talks to", () => {
  const book = csp("/book.html"), app = csp("/app.html");
  for (const p of [book, app]) assert.ok(p["connect-src"].includes(supabaseUrl), "Supabase API");
  assert.ok(book["script-src"].includes("https://js.stripe.com") && book["frame-src"].includes("https://js.stripe.com"), "Stripe.js");
  assert.ok(book["connect-src"].includes("https://api.stripe.com"));
  assert.ok(book["script-src"].includes("https://www.googletagmanager.com"), "Google Analytics");
  assert.deepEqual(app["script-src"], ["'self'"], "dashboard runs only our own scripts");
  assert.ok(app["frame-src"].includes("'self'"), "studio preview iframe");
  for (const p of [book, app, csp("/")]) assert.ok(p["font-src"].includes("https://fonts.gstatic.com") && p["style-src"].includes("https://fonts.googleapis.com"));
});

test("HTML pages carry no inline executable scripts or inline event handlers", () => {
  for (const page of ["index.html", "app.html", "book.html"]) {
    const html = read(page);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].filter((m) => !/application\/ld\+json/.test(m[1]));
    assert.equal(inline.length, 0, `${page}: inline <script>`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${page}: inline event handler`);
    assert.doesNotMatch(html, /href="javascript:/i);
  }
});

test("repo internals are not published with the site", () => {
  const ignore = read(".assetsignore").split("\n").map((l) => l.trim());
  for (const entry of ["supabase", "scripts", "tests", "/README.md", ".github", ".env*", ".git", ".agents"]) {
    assert.ok(ignore.includes(entry), `.assetsignore missing ${entry}`);
  }
  assert.ok(!ignore.includes("_headers"), "_headers must stay visible to Cloudflare");
});

test("Edge Function dependencies are pinned in one place", () => {
  const deps = read("supabase/functions/_shared/deps.ts");
  assert.match(deps, /stripe@\d+\.\d+\.\d+\?target=deno/);
  assert.match(deps, /supabase-js@\d+\.\d+\.\d+"/);
  const fnDir = new URL("../supabase/functions/", import.meta.url);
  for (const name of readdirSync(fnDir).filter((n) => !n.startsWith("_") && existsSync(new URL(n + "/index.ts", fnDir)))) {
    const src = read(`supabase/functions/${name}/index.ts`);
    assert.doesNotMatch(src, /https:\/\/esm\.sh\//, `${name}: import through _shared/deps.ts`);
  }
});

test("browser-called functions grant CORS only to our own origins", () => {
  for (const name of ["accept-invite", "charge-guest", "create-checkout", "ical-sync", "send-email", "stripe-connect", "support-ai"]) {
    const src = read(`supabase/functions/${name}/index.ts`);
    assert.match(src, /Deno\.serve\(withCors\(async \(req\) => \{/, name);
    assert.doesNotMatch(src, /"Access-Control-Allow-Origin": "\*"/, name);
  }
  assert.ok(isOwnOrigin("https://simplehotelier.com"));
  assert.ok(isOwnOrigin("https://pocketmacro.simplehotelier.com"));
  assert.ok(isOwnOrigin("http://localhost:8000"));
  assert.ok(!isOwnOrigin("https://simplehotelier.com.evil.example"));
  assert.ok(!isOwnOrigin("http://simplehotelier.com"), "https only");
  assert.ok(!isOwnOrigin("https://evil.example"));
  assert.ok(isOwnOrigin("https://preview.example", ["https://preview.example"]), "ALLOWED_ORIGINS");
});

test("Spark has a per-user daily limit enforced before the paid API call", () => {
  const src = read("supabase/functions/support-ai/index.ts");
  const bump = src.indexOf('admin.rpc("bump_ai_usage"');
  assert.ok(bump > 0 && bump < src.indexOf("api.meta.ai"), "count before calling the model");
  assert.match(src, /> DAILY_LIMIT\) return json\(\{ error: "daily_limit"/);
  const sql = read("supabase/migrations/20261119000000_ai_usage_limit.sql");
  assert.match(sql, /on conflict \(user_id, day\) do update set questions = u\.questions \+ 1/);
  assert.match(sql, /revoke execute on function public\.bump_ai_usage\(uuid\) from public, anon, authenticated/);
  assert.match(read("js/support.js"), /res\.status === 429/);
});

test("CI runs the tests and lints the functions", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /node --test tests\/\*\.test\.mjs/);
  assert.match(ci, /deno lint supabase\/functions/);
  assert.match(ci, /permissions:\s*\n\s*contents: read/);
});
