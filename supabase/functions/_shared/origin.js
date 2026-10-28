/* SimpleHotelier — which site origins may appear in links we generate.
   Plain ESM (Deno + Node tests). Email links and Stripe return URLs must
   point at our own site, never at whatever Origin header or body field a
   caller sends (that turned real invite emails into phishing links).
   "Our own" is the platform domain in site.config.json (_shared/site.js). */
import { SITE } from "./site.js";

/* The platform domain or one of its subdomains (property booking pages). */
const ownHost = (host) => host === SITE.domain || host.endsWith("." + SITE.domain);

/**
 * Return `candidate`'s origin when it is one of ours, otherwise `site`.
 * Ours: the configured site, the platform domain and its subdomains,
 * any origin listed in `extra`, and http://localhost / 127.0.0.1 for dev.
 * @param {string | null | undefined} candidate
 * @param {{ site?: string, extra?: string[] }} [options]
 */
export function safeOrigin(candidate, { site = SITE.siteUrl, extra = [] } = {}) {
  const fallback = String(site).replace(/\/$/, "");
  if (!candidate) return fallback;
  let u;
  try { u = new URL(String(candidate)); } catch { return fallback; }
  const host = u.hostname.toLowerCase();
  const allowed = extra.map((s) => String(s).trim().replace(/\/$/, "")).filter(Boolean);
  if (u.origin === fallback || allowed.includes(u.origin)) return u.origin;
  if (u.protocol === "https:" && ownHost(host)) return u.origin;
  if (u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1")) return u.origin;
  return fallback;
}

/**
 * Browser origins allowed to call our functions (CORS): the site, property
 * subdomains, the config's extraOrigins (e.g. a workers.dev deployment),
 * localhost/127.0.0.1, and `extra`.
 * @param {string | null | undefined} origin
 * @param {string[]} [extra]
 */
export function isOwnOrigin(origin, extra = []) {
  let u;
  try { u = new URL(String(origin)); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (extra.map((s) => String(s).trim().replace(/\/$/, "")).filter(Boolean).includes(u.origin)) return true;
  if (u.protocol === "https:" && ownHost(host)) return true;
  if (SITE.extraOrigins.includes(u.origin)) return true;
  return u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
}

/**
 * Feed URLs the server is willing to fetch (iCal sync): https only, a DNS
 * name (no IP literals), and nothing that names a local/internal host.
 * Returns an error sentence, or "" when the URL is acceptable.
 */
export function feedUrlProblem(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return "Calendar link is not a valid URL"; }
  if (u.protocol !== "https:") return "Calendar link must start with https://";
  if (u.username || u.password) return "Calendar link must not contain a login";
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return "Calendar link must use a public web address";
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return "Calendar link must use a web address, not an IP";
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) return "Calendar link must use a public web address";
  if (u.port && u.port !== "443") return "Calendar link must use the standard https port";
  return "";
}
