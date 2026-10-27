// SimpleHotelier — transactional email over Amazon SES SMTP.
// Secrets: SES_SMTP_HOST, SES_SMTP_USER, SES_SMTP_PASS (SES SMTP credentials).
// deno-lint-ignore-file no-explicit-any
import nodemailer from "npm:nodemailer@6.9.14";
import { cleanEmail, senderName } from "./brand.js";
import { logError } from "./errors.ts";
export { propertyBrand } from "./brand.js";

const FROM = Deno.env.get("EMAIL_FROM") || "noreply@simplehotelier.com";

let transporter: any = null;
function transport() {
  if (transporter) return transporter;
  const host = Deno.env.get("SES_SMTP_HOST");
  const user = Deno.env.get("SES_SMTP_USER");
  const pass = Deno.env.get("SES_SMTP_PASS");
  if (!host || !user || !pass) throw new Error("SES SMTP secrets not configured (SES_SMTP_HOST/USER/PASS)");
  transporter = nodemailer.createTransport({ host, port: 587, secure: false, auth: { user, pass } });
  return transporter;
}

export function emailConfigured() {
  return !!(Deno.env.get("SES_SMTP_HOST") && Deno.env.get("SES_SMTP_USER") && Deno.env.get("SES_SMTP_PASS"));
}

/* Escape every guest/owner-entered value before it goes into p() or a
   footnote: names, property names and policy text are not trusted HTML. */
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]);

/* Email shell. Guest emails pass the property's brand (propertyBrand):
   its logo/name on its button color, and its contact details in the footer.
   Emails to owners and teams keep the SimpleHotelier look. */
export function emailShell(heading: string, bodyHtml: string, footnote = "", brand?: any) {
  const header = brand
    ? `<tr><td style="background:${brand.color};padding:20px 30px">
          ${brand.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}" height="40" style="height:40px;max-width:180px;border-radius:8px;vertical-align:middle;margin-right:12px;border:0">` : ""}<span style="font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;letter-spacing:-.01em;color:${brand.ink};vertical-align:middle">${esc(brand.name)}</span>
        </td></tr>`
    : `<tr><td style="background:#0a2a2b;padding:22px 30px">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#ffffff">Simple<span style="color:#e0aa4e">Hotelier</span></span>
        </td></tr>`;
  const footer = brand
    ? [`<strong style="color:#33413f">${esc(brand.name)}</strong>`, brand.place && esc(brand.place), brand.phone && esc(brand.phone),
        brand.replyTo && `<a href="mailto:${esc(brand.replyTo)}" style="color:${brand.link}">${esc(brand.replyTo)}</a>`,
        brand.website && `<a href="${esc(brand.website)}" style="color:${brand.link}">${esc(brand.website.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`]
        .filter(Boolean).join(" · ")
    : `Sent by SimpleHotelier on behalf of the property · <a href="https://simplehotelier.com" style="color:#115152">simplehotelier.com</a>`;
  return `<div style="margin:0;padding:0;background:#edf0ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf0ee;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe4e1">
        ${header}
        <tr><td style="padding:28px 30px 10px">
          <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.25;color:#101f1e;margin:0 0 14px">${esc(heading)}</h1>
          ${bodyHtml}
        </td></tr>
        ${footnote ? `<tr><td style="padding:6px 30px 24px"><p style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#5f7a73;margin:0">${footnote}</p></td></tr>` : ""}
        <tr><td style="background:#f6f8f7;border-top:1px solid #e8eeec;padding:16px 30px">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5f7a73;margin:0">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;
}

export const p = (text: string) => `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:#33413f;margin:0 0 10px">${text}</p>`;
export const kv = (rows: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px">${rows.map(([k, v]) =>
    `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5f7a73;padding:3px 18px 3px 0">${esc(k)}</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13.5px;font-weight:600;color:#101f1e;padding:3px 0">${esc(v)}</td></tr>`).join("")}</table>`;

/* A call-to-action link styled as a button in the brand's color. */
export const button = (href: string, label: string, brand?: any) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${brand ? brand.color : "#0c3b3c"};color:${brand ? brand.ink : "#ffffff"};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px">${esc(label)}</a>`;

/* fromName shows as the sender (the address stays our verified domain);
   replyTo sends guests' replies to the property. */
export async function sendMail({ to, subject, html, text, fromName, replyTo }:
  { to: string | string[]; subject: string; html: string; text?: string; fromName?: string; replyTo?: string }) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return { sent: false, reason: "no recipient" };
  const reply = cleanEmail(replyTo);
  let info;
  try {
    info = await transport().sendMail({
      from: { name: senderName(fromName) || "SimpleHotelier", address: FROM },
      ...(reply ? { replyTo: reply } : {}),
      to: list.join(", "),
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    });
  } catch (e) {
    // Delivery problems (SES limits, bad credentials) show in Site errors.
    console.error("email", e);
    await logError("email", e);
    throw e;
  }
  return { sent: true, id: info.messageId };
}

export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "USD").toUpperCase() }).format((cents || 0) / 100);

export const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
