// Focused test: the platform's name, domain, emails, plan and logo come from
// site.config.json (scripts/site.mjs applies it), so anyone can run their own
// copy under their own brand.
// Risks covered: the pages drifting from the config, a rebrand leaving the
// old name, domain, price or trial behind (or rewriting unrelated text like
// "30 days" of error-log retention), a bad config value breaking pages, and
// new code hard-coding the brand again instead of reading SITE.
// Run: node --test tests/site-config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, cpSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plan, normalize, rebrand, priceLabel } from "../scripts/site.mjs";
import { SITE } from "../supabase/functions/_shared/site.js";
import { isOwnOrigin, safeOrigin } from "../supabase/functions/_shared/origin.js";
import { wordmark } from "../supabase/functions/_shared/brand.js";

const ROOT = new URL("../", import.meta.url);
const root = ROOT.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const config = JSON.parse(read("site.config.json"));
const FORK = {
  name: "Lakeside Stays", domain: "lakeside.example", bookingSubdomains: false, extraOrigins: [],
  supportEmail: "help@lakeside.example", emailFrom: "bookings@lakeside.example",
  plan: { priceCents: 2450, currency: "EUR", trialDays: 14 },
  logoMark: "assets/logo-mark.svg", favicon: "assets/favicon.svg", sourceUrl: "https://git.lakeside.example/stays"
};

/* A scratch copy of everything scripts/site.mjs reads or writes. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "sh-site-")) + "/";
  for (const f of readdirSync(root)) {
    if (/\.(html|txt|xml|json)$/.test(f) || f === "_headers") cpSync(root + f, dir + f);
  }
  cpSync(root + "assets", dir + "assets", { recursive: true });
  mkdirSync(dir + "js");
  cpSync(root + "js/site.js", dir + "js/site.js");
  cpSync(root + "js/config.js", dir + "js/config.js");
  mkdirSync(dir + "supabase/functions/_shared", { recursive: true });
  cpSync(root + "supabase/functions/_shared/site.js", dir + "supabase/functions/_shared/site.js");
  return dir;
}
const apply = (dir, cfg) => { for (const c of plan(dir, cfg)) writeFileSync(dir + c.path, c.after); };

test("the repo matches site.config.json (run node scripts/site.mjs after editing it)", () => {
  assert.deepEqual(plan(root).map((c) => c.path), []);
  assert.equal(SITE.name, config.name);
  assert.equal(SITE.siteUrl, "https://" + config.domain);
  assert.equal(SITE.priceLabel, priceLabel(config.plan.priceCents, config.plan.currency));
  assert.deepEqual([priceLabel(4500, "USD"), priceLabel(2950, "EUR"), priceLabel(3000, "GBP")], ["$45", "€29.50", "£30"]);
});

test("a rebrand reaches every static page and round-trips back exactly", () => {
  const dir = scratch();
  try {
    const before = Object.fromEntries(plan(dir, FORK).map((c) => [c.path, c.before]));
    apply(dir, FORK);
    for (const path of Object.keys(before).filter((p) => !p.endsWith("site.js"))) {
      const text = readFileSync(dir + path, "utf8");
      assert.doesNotMatch(text, /simplehotelier|\$30(?!\d)|"price":"30"|30-day|30 days free/i, path + " still has the old brand");
    }
    const index = readFileSync(dir + "index.html", "utf8");
    assert.match(index, /<title>[^<]*\| Lakeside Stays<\/title>/);
    assert.match(index, /"price":"24\.50","priceCurrency":"EUR"/);
    assert.match(index, /€24\.50/);
    assert.match(readFileSync(dir + "terms.html", "utf8"), /14-day free trial[\s\S]*14 days free[\s\S]*help@lakeside\.example/);
    assert.match(readFileSync(dir + "privacy.html", "utf8"), /Error reports:<\/strong> 30 days\./, "other periods stay as written");
    assert.match(readFileSync(dir + "app.html", "utf8"), /Drag-free 14-day board/, "not a trial: untouched, and not turned into a 30-day board on the way back");
    assert.match(readFileSync(dir + "book.html", "utf8"), /Powered by <strong>Lakeside Stays<\/strong>.*https:\/\/lakeside\.example\/privacy/);
    assert.match(readFileSync(dir + "assets/logo.svg", "utf8"), /aria-label="Lakeside Stays"/);
    for (const page of ["index.html", "terms.html", "privacy.html", "book.html", "app.html"]) {
      assert.match(readFileSync(dir + page, "utf8"), /href="https:\/\/git\.lakeside\.example\/stays"[^>]*>Source code/, page + " links the fork's source");
    }
    assert.match(readFileSync(dir + "js/site.js", "utf8"), /"name": "Lakeside Stays"[\s\S]*"bookingSubdomains": false/);
    assert.match(readFileSync(dir + "supabase/functions/_shared/site.js", "utf8"), /export const SITE = Object\.freeze\(\{\s+"name": "Lakeside Stays"/);
    assert.deepEqual(plan(dir, FORK), [], "applying twice changes nothing");

    apply(dir, config);
    for (const [path, text] of Object.entries(before)) assert.equal(readFileSync(dir + path, "utf8"), text, path + " restored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rebrand is one pass: new values are never replaced again", () => {
  const prev = normalize(config, root);
  const next = normalize({ ...config, name: "SimpleHotelier Plus", domain: "simplehotelier.com.example" }, root);
  assert.equal(rebrand("SimpleHotelier at simplehotelier.com", prev, next), "SimpleHotelier Plus at simplehotelier.com.example");
  const at = (priceCents) => normalize({ ...config, plan: { ...config.plan, priceCents } }, root);
  assert.equal(rebrand("$30 and $300 and $30.50 and $30.", at(3000), at(2500)),
    "$25 and $300 and $30.50 and $25.");
});

test("bad config values are refused with a reason", () => {
  const bad = (patch, why) => assert.throws(() => normalize({ ...config, ...patch }, root), why);
  bad({ name: "<b>Inn</b>" }, /name/);
  bad({ name: "Stay & Co" }, /name/);
  bad({ domain: "https://x.com" }, /domain/);
  bad({ supportEmail: "nobody" }, /supportEmail/);
  bad({ extraOrigins: ["http://x.example"] }, /extraOrigins/);
  bad({ plan: { priceCents: 30.5, currency: "USD", trialDays: 30 } }, /priceCents/);
  bad({ plan: { priceCents: 3000, currency: "dollars", trialDays: 30 } }, /currency/);
  bad({ plan: { priceCents: 3000, currency: "USD", trialDays: 0 } }, /trialDays/);
  bad({ logoMark: "assets/missing.svg" }, /does not exist/);
  bad({ favicon: "../outside.svg" }, /favicon/);
  bad({ sourceUrl: "" }, /sourceUrl/);
  bad({ sourceUrl: "http://github.com/x/y" }, /sourceUrl/);
});

test("server origin checks follow the configured domain", () => {
  assert.ok(isOwnOrigin("https://" + SITE.domain));
  assert.ok(isOwnOrigin("https://pinecrest." + SITE.domain));
  for (const o of SITE.extraOrigins) assert.ok(isOwnOrigin(o));
  assert.ok(!isOwnOrigin("https://" + SITE.domain + ".evil.example"));
  assert.ok(!isOwnOrigin("http://" + SITE.domain), "https only");
  assert.equal(safeOrigin("https://evil.example"), SITE.siteUrl);
  assert.equal(wordmark("SimpleHotelier", "#e0aa4e"), 'Simple<span style="color:#e0aa4e">Hotelier</span>');
  assert.equal(wordmark("Lakeside Stays", "#000"), 'Lakeside <span style="color:#000">Stays</span>');
  assert.equal(wordmark("acme", "#000"), "acme");
});

/* AGPL section 13: everyone using the platform over the network can get its
   source: the landing page, legal pages, booking page, sign-in and dashboard. */
test("every page people use links the source code", () => {
  const link = `href="${SITE.sourceUrl}"`;
  for (const page of ["index.html", "terms.html", "privacy.html", "book.html"]) assert.ok(read(page).includes(link), page);
  const app = read("app.html");
  assert.ok(app.includes(`<a class="side-source" ${link}`), "dashboard sidebar");
  assert.ok(app.includes(`<p class="auth-side-note auth-source"><a ${link}`), "sign-in screen");
  assert.match(read("LICENSE"), /^\s+GNU AFFERO GENERAL PUBLIC LICENSE\n\s+Version 3, 19 November 2007\n/);
  // Embedded on a property's site the footer folds to "Privacy · Source code";
  // the link must not sit inside anything embed mode hides.
  const powered = read("book.html").match(/<p class="bk-powered">([\s\S]*?)<\/p>/)[1];
  assert.ok(powered.replace(/<span class="bk-powered-by">[\s\S]*?<\/span>/, "").includes(link), "source link outside the hidden part");
  const css = read("css/book.css");
  assert.match(css, /body\.embed \.bk-foot-in, body\.embed \.bk-powered-by \{ display: none; \}/);
  assert.doesNotMatch(css, /body\.embed[^{]*\.bk-(foot|powered)\s*[,{][^}]*display: none/, "embed mode keeps the footer line");
});

test("pages load js/site.js before the scripts that read it", () => {
  const before = (html, a, b) => assert.ok(html.indexOf(`src="${a}"`) > -1 && html.indexOf(`src="${a}"`) < html.indexOf(`src="${b}"`), `${a} before ${b}`);
  before(read("app.html"), "js/site.js", "js/app.js");
  before(read("book.html"), "js/site.js", "js/book.js");
  before(read("index.html"), "js/site.js", "js/subdomain-redirect.js");
});

/* Code reads the brand from SITE: no name, domain or price in strings.
   Comments may still say SimpleHotelier (it's this project's name). */
test("no hard-coded brand in browser code, functions or setup scripts", () => {
  const files = [
    ...readdirSync(root + "js").filter((f) => f.endsWith(".js") && f !== "site.js").map((f) => "js/" + f),
    ...readdirSync(root + "supabase/functions", { recursive: true }).map((f) => "supabase/functions/" + String(f).replaceAll("\\", "/"))
      .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith("_shared/site.js") && statSync(root + f).isFile()),
    "scripts/set-auth-emails.mjs", "scripts/setup-platform.mjs"
  ];
  const offenders = [];
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    for (const m of code.matchAll(/SimpleHotelier|simplehotelier\.com|pocketmacro|\$30(?!\d)/g)) offenders.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(offenders, []);
});
