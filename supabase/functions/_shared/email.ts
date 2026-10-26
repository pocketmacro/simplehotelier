// SimpleHotelier — transactional email over Amazon SES SMTP.
// Secrets: SES_SMTP_HOST, SES_SMTP_USER, SES_SMTP_PASS (SES SMTP credentials).
// deno-lint-ignore-file no-explicit-any
import nodemailer from "npm:nodemailer@6.9.14";

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

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Branded shell matching simplehotelier.com: deep pine header, brass accents. */
export function emailShell(heading: string, bodyHtml: string, footnote = "") {
  return `<div style="margin:0;padding:0;background:#edf0ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf0ee;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe4e1">
        <tr><td style="background:#0a2a2b;padding:22px 30px">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#ffffff">Simple<span style="color:#e0aa4e">Hotelier</span></span>
        </td></tr>
        <tr><td style="padding:28px 30px 10px">
          <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.25;color:#101f1e;margin:0 0 14px">${esc(heading)}</h1>
          ${bodyHtml}
        </td></tr>
        ${footnote ? `<tr><td style="padding:6px 30px 24px"><p style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#5f7a73;margin:0">${footnote}</p></td></tr>` : ""}
        <tr><td style="background:#f6f8f7;border-top:1px solid #e8eeec;padding:16px 30px">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5f7a73;margin:0">Sent by SimpleHotelier on behalf of the property · <a href="https://simplehotelier.com" style="color:#115152">simplehotelier.com</a></p>
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

export async function sendMail({ to, subject, html, text }: { to: string | string[]; subject: string; html: string; text?: string }) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return { sent: false, reason: "no recipient" };
  const info = await transport().sendMail({
    from: `"SimpleHotelier" <${FROM}>`,
    to: list.join(", "),
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  });
  return { sent: true, id: info.messageId };
}

export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "USD").toUpperCase() }).format((cents || 0) / 100);

export const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
