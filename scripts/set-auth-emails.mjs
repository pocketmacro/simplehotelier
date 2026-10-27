// SimpleHotelier — brand the Supabase auth emails and point them at Amazon SES.
// Prereqs (one-time, in AWS + Cloudflare):
//   1. SES console: verify the domain simplehotelier.com, add the DKIM CNAME
//      records it gives you to Cloudflare DNS, and request production access
//      (sandbox mode can only email verified addresses).
//   2. SES console > SMTP settings > Create SMTP credentials.
//   3. Add to .env (never commit): SES_SMTP_HOST, SES_SMTP_USER, SES_SMTP_PASS
//      e.g. SES_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
// Run: node scripts/set-auth-emails.mjs
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = {};
for (const line of readFileSync(root + ".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref || !env.SUPABASE_TOKEN) { console.error("ABORT: .env needs SUPABASE_TOKEN + NEXT_PUBLIC_SUPABASE_URL"); process.exit(1); }
const { SES_SMTP_HOST, SES_SMTP_USER, SES_SMTP_PASS } = env;
if (!SES_SMTP_HOST || !SES_SMTP_USER || !SES_SMTP_PASS) {
  console.error("ABORT: add SES_SMTP_HOST, SES_SMTP_USER and SES_SMTP_PASS to .env first (SES console > SMTP settings).");
  process.exit(1);
}

const FROM = env.AUTH_FROM_EMAIL || "noreply@simplehotelier.com";

/* Branded shell matching simplehotelier.com: deep pine header, brass button.
   Email clients ignore SVG and webfonts, so the wordmark is styled text. */
const shell = (heading, intro, buttonLabel, footnote) => `
<div style="margin:0;padding:0;background:#edf0ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf0ee;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe4e1">
        <tr><td style="background:#0a2a2b;padding:22px 30px">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.02em;color:#ffffff">Simple<span style="color:#e0aa4e">Hotelier</span></span>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9dbcb5;margin-top:3px">Reservations, housekeeping and direct bookings for cabins and small hotels</div>
        </td></tr>
        <tr><td style="padding:28px 30px 8px">
          <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.25;color:#101f1e;margin:0 0 12px">${heading}</h1>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:#33413f;margin:0 0 8px">${intro}</p>
        </td></tr>
        <tr><td style="padding:14px 30px 6px">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#96621e;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px">${buttonLabel}</a>
        </td></tr>
        <tr><td style="padding:14px 30px 26px">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#5f7a73;margin:0 0 6px">${footnote}</p>
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5f7a73;margin:0;word-break:break-all">{{ .ConfirmationURL }}</p>
        </td></tr>
        <tr><td style="background:#f6f8f7;border-top:1px solid #e8eeec;padding:16px 30px">
          <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5f7a73;margin:0">SimpleHotelier · $30/month, everything included · <a href="https://simplehotelier.com" style="color:#115152">simplehotelier.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>`;

const templates = {
  mailer_subjects_confirmation: "Confirm your SimpleHotelier account",
  mailer_templates_confirmation_content: shell(
    "Confirm your email address",
    "Welcome to SimpleHotelier. Confirm this email address to finish creating your account and set up your property.",
    "Confirm my email",
    "If you did not sign up for SimpleHotelier, you can safely ignore this email. The button does not work? Copy and paste this link into your browser:"
  ),
  mailer_subjects_recovery: "Reset your SimpleHotelier password",
  mailer_templates_recovery_content: shell(
    "Reset your password",
    "We received a request to reset the password for your SimpleHotelier account. Choose a new one with the button below.",
    "Reset my password",
    "If you did not request this, ignore this email and your password stays the same. The button does not work? Copy and paste this link into your browser:"
  ),
  mailer_subjects_magic_link: "Your SimpleHotelier sign-in link",
  mailer_templates_magic_link_content: shell(
    "Sign in to SimpleHotelier",
    "Use the button below to sign in. This link expires shortly and can only be used once.",
    "Sign in",
    "If you did not request this link, you can safely ignore this email. The button does not work? Copy and paste this link into your browser:"
  ),
  mailer_subjects_invite: "You've been invited to SimpleHotelier",
  mailer_templates_invite_content: shell(
    "You've been invited",
    "You've been invited to join a property team on SimpleHotelier. Accept the invite to create your account and get started.",
    "Accept the invite",
    "If you weren't expecting this, you can safely ignore this email. The button does not work? Copy and paste this link into your browser:"
  ),
  mailer_subjects_email_change: "Confirm your new SimpleHotelier email",
  mailer_templates_email_change_content: shell(
    "Confirm your new email address",
    "Follow the button below to confirm {{ .NewEmail }} as the new email address for your SimpleHotelier account.",
    "Confirm new email",
    "If you did not request this change, contact support right away. The button does not work? Copy and paste this link into your browser:"
  )
};

const body = {
  site_url: "https://simplehotelier.com",
  uri_allow_list: "https://simplehotelier.com/**,https://simplehotelier.pocketmacro.workers.dev/**,http://localhost:3000/**",
  smtp_host: SES_SMTP_HOST,
  smtp_port: String(env.SES_SMTP_PORT || 587),
  smtp_user: SES_SMTP_USER,
  smtp_pass: SES_SMTP_PASS,
  smtp_admin_email: FROM,
  smtp_sender_name: "SimpleHotelier",
  // Auth emails per hour, project-wide (sign-up confirmations + password
  // resets share it). Supabase's default of 2 is meant for its own test
  // mailer; with SES behind it, 100 leaves room for real traffic.
  rate_limit_email_sent: 100,
  ...templates
};

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const out = await res.json().catch(() => ({}));
if (!res.ok) { console.error("FAILED HTTP", res.status, JSON.stringify(out).slice(0, 400)); process.exit(1); }
console.log("OK — SMTP:", out.smtp_host, "| from:", out.smtp_admin_email, "| sender:", out.smtp_sender_name);
console.log("Templates branded:", Object.keys(templates).filter((k) => k.includes("templates")).length);
console.log("Now send a test: sign up with a fresh email (or use Supabase Auth > Users > Send invitation) and check the inbox.");
