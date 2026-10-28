// SimpleHotelier — apply site.config.json (the platform's name, domain,
// emails, plan price, logo and source link) to the whole project. There is no build step:
// this rewrites files in place, and is safe to run again after every change.
//  * js/site.js: window.SH_SITE for the browser. It also records the values
//    the static pages now carry, so the next run knows what to replace.
//  * supabase/functions/_shared/site.js: SITE for the Edge Functions.
//  * Static pages (*.html, llms.txt, robots.txt, sitemap.xml, assets/*.svg):
//    the recorded name, domain, emails, price, trial length, logo paths and
//    source link are replaced with the new ones, so titles, meta tags and legal pages are
//    right without JavaScript.
//  * _headers: the CSP's Supabase host follows SUPABASE_URL in js/config.js.
// Run: node scripts/site.mjs            apply
//      node scripts/site.mjs --check    exit 1 when anything is out of date
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BROWSER_FILE = "js/site.js";
const SERVER_FILE = "supabase/functions/_shared/site.js";
const read = (root, p) => (existsSync(root + p) ? readFileSync(root + p, "utf8") : null);

/* "$30", "€25", "$29.50": whole amounts drop the cents. */
export function priceLabel(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2
  }).format(cents / 100);
}

/* Check the config and add what is derived from it (siteUrl, priceLabel). */
export function normalize(cfg, root = ROOT) {
  const fail = (msg) => { throw new Error("site.config.json: " + msg); };
  const c = cfg && typeof cfg === "object" ? cfg : fail("not a JSON object");
  // Values are written into HTML and JSON-LD as they are: no markup characters.
  const name = String(c.name || "").trim();
  if (!name || name.length > 60 || /[<>"&\\\p{Cc}]/u.test(name)) fail("name: 1-60 characters, without < > \" & or \\");
  const domain = String(c.domain || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) fail("domain: a host name like example.com");
  const email = (k) => {
    const v = String(c[k] || "").trim();
    if (!/^[^@\s<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) fail(k + ": an email address");
    return v;
  };
  const extraOrigins = (Array.isArray(c.extraOrigins) ? c.extraOrigins : []).map((o) => {
    let u;
    try { u = new URL(String(o)); } catch { fail("extraOrigins: " + o + " is not a URL"); }
    if (u.protocol !== "https:" || u.origin !== String(o).replace(/\/$/, "")) fail("extraOrigins: " + o + " must be an https origin, like https://app.example.com");
    return u.origin;
  });
  const p = c.plan || {};
  const priceCents = Number(p.priceCents), trialDays = Number(p.trialDays);
  const currency = String(p.currency || "").trim().toUpperCase();
  if (!Number.isInteger(priceCents) || priceCents < 0) fail("plan.priceCents: whole cents, e.g. 3000 for 30.00");
  if (!/^[A-Z]{3}$/.test(currency)) fail("plan.currency: a 3-letter code like USD");
  if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 730) fail("plan.trialDays: 1 to 730");
  const asset = (k) => {
    const v = String(c[k] || "").trim();
    if (!/^[\w-]+(\/[\w.-]+)*\.(svg|png|ico|webp|jpg)$/i.test(v) || v.includes("..")) fail(k + ": a path in this repo, like assets/logo.svg");
    if (!existsSync(root + v)) fail(k + ": " + v + " does not exist");
    return v;
  };
  // AGPL section 13: everyone using a modified copy over the network must be
  // offered its source, so every page footer links here.
  const sourceUrl = String(c.sourceUrl || "").trim();
  let src;
  try { src = new URL(sourceUrl); } catch { /* checked below */ }
  if (!src || src.protocol !== "https:" || /["'<>\s]/.test(sourceUrl)) fail("sourceUrl: the https link to this copy's source code (AGPL)");
  return {
    name, domain, siteUrl: "https://" + domain, bookingSubdomains: c.bookingSubdomains !== false, extraOrigins,
    supportEmail: email("supportEmail"), emailFrom: email("emailFrom"),
    plan: { priceCents, currency, trialDays }, priceLabel: priceLabel(priceCents, currency),
    logoMark: asset("logoMark"), favicon: asset("favicon"), sourceUrl
  };
}

/* What js/site.js says the pages carry now (null on a first run). */
export function recorded(text) {
  const m = text && text.match(/window\.SH_SITE = (\{[\s\S]*\});/);
  return m ? JSON.parse(m[1]) : null;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const amount = (cents) => (cents / 100).toFixed(cents % 100 ? 2 : 0);

/* One pass over the text, so a new value is never replaced again. */
export function rebrand(text, prev, next) {
  const pairs = [];
  const add = (src, to) => pairs.push({ src, to });
  const lit = (a, b) => { if (a && b && a !== b) add(esc(a), b); };
  lit(prev.sourceUrl, next.sourceUrl); // first: it may contain the domain or name
  lit(prev.supportEmail, next.supportEmail);
  lit(prev.emailFrom, next.emailFrom);
  lit(prev.logoMark, next.logoMark);
  lit(prev.favicon, next.favicon);
  lit(prev.domain, next.domain);
  lit(prev.name, next.name);
  if (prev.priceLabel !== next.priceLabel) add(esc(prev.priceLabel) + "(?!\\d|[.,]\\d)", next.priceLabel);
  if (prev.plan.priceCents !== next.plan.priceCents) add(esc(`"price":"${amount(prev.plan.priceCents)}"`), `"price":"${amount(next.plan.priceCents)}"`);
  if (prev.plan.currency !== next.plan.currency) add(esc(`"priceCurrency":"${prev.plan.currency}"`), `"priceCurrency":"${next.plan.currency}"`);
  // Trial wording only ("30-day free trial", "30 days free"); other periods
  // ("14-day board", "30 days" of log retention) stay as written.
  if (prev.plan.trialDays !== next.plan.trialDays) add(`(?<!\\d)${prev.plan.trialDays}(?=-day free trial\\b| days free\\b)`, String(next.plan.trialDays));
  if (!pairs.length) return text;
  const re = new RegExp(pairs.map((p) => `(${p.src})`).join("|"), "g");
  return text.replace(re, (...m) => pairs[m.slice(1, pairs.length + 1).findIndex((g) => g !== undefined)].to);
}

function staticFiles(root) {
  const top = readdirSync(root).filter((f) => f.endsWith(".html"));
  const svg = existsSync(root + "assets") ? readdirSync(root + "assets").filter((f) => f.endsWith(".svg")).map((f) => "assets/" + f) : [];
  return [...top, "llms.txt", "robots.txt", "sitemap.xml", ...svg].filter((p) => existsSync(root + p)).sort();
}

const browserFile = (site) => `// Generated by scripts/site.mjs from site.config.json: the platform's name,
// domain, emails, plan and logo for the browser. Edit site.config.json, then
// run \`node scripts/site.mjs\` (this file also records what the pages say).
window.SH_SITE = ${JSON.stringify(site, null, 2)};
`;
const serverFile = (site) => `// Generated by scripts/site.mjs from site.config.json: the platform's name,
// domain, emails and plan for the Edge Functions. Edit site.config.json, then
// run \`node scripts/site.mjs\` and redeploy the functions.
export const SITE = Object.freeze(${JSON.stringify(site, null, 2)});
`;

/* Every file the config changes: [{ path, before, after }]. */
export function plan(root = ROOT, config = JSON.parse(readFileSync(root + "site.config.json", "utf8"))) {
  const next = normalize(config, root);
  const prev = recorded(read(root, BROWSER_FILE)) || next;
  const out = [];
  const put = (path, after) => { const before = read(root, path); if (before !== after) out.push({ path, before, after }); };
  for (const path of staticFiles(root)) put(path, rebrand(read(root, path), prev, next));
  const supabaseUrl = (read(root, "js/config.js") || "").match(/SUPABASE_URL:\s*"(https:\/\/[a-z0-9-]+\.supabase\.co)\/?"/);
  const headers = read(root, "_headers");
  if (supabaseUrl && headers) put("_headers", headers.replace(/https:\/\/[a-z0-9-]+\.supabase\.co\b/g, supabaseUrl[1]));
  put(BROWSER_FILE, browserFile(next));
  put(SERVER_FILE, serverFile(next));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const changes = plan();
    if (process.argv.includes("--check")) {
      if (changes.length) {
        console.error("Out of date with site.config.json (run node scripts/site.mjs): " + changes.map((c) => c.path).join(", "));
        process.exit(1);
      }
      console.log("site config: everything up to date");
    } else {
      for (const c of changes) writeFileSync(ROOT + c.path, c.after);
      console.log(changes.length ? "updated: " + changes.map((c) => c.path).join(", ") : "site config: nothing to change");
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
