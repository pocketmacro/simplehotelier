// SimpleHotelier — a property's look for the emails its guests receive:
// its name, logo, booking-page button color and contact details. Guests
// reply to the property, not to SimpleHotelier. Plain JS so node tests can
// import it (tests/email-brand.test.mjs).

// Booking page presets' button colors (js/booking-theme.js PRESETS).
const PRESET_BRAND = {
  meadow: "#2f5d46", pine: "#0c3b3c", coastal: "#1f5f7a",
  desert: "#a0522d", modern: "#111111", evening: "#d4a85a"
};

const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/* Text color that reads on a background: white or near-black. */
export const onColor = (hex) => (contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111");

/* One plain address (no lists, names or header tricks), else "". */
export function cleanEmail(v) {
  const s = String(v || "").trim();
  return s.length <= 254 && /^[^@\s,;<>"'()\\]+@[^@\s,;<>"'()\\]+\.[^@\s,;<>"'()\\]+$/.test(s) ? s : "";
}

export function httpsUrl(v) {
  try { const u = new URL(String(v || "").trim()); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; }
}

/* The platform's name as an email wordmark: a CamelCase or two-word name
   gets its second part in the accent color ("Simple" + "Hotelier"). */
export function wordmark(name, accent) {
  const n = String(name || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const at = Math.max(n.lastIndexOf(" ") + 1, n.search(/[a-z][A-Z][^A-Z]*$/) + 1);
  return at > 0 && at < n.length ? `${n.slice(0, at)}<span style="color:${accent}">${n.slice(at)}</span>` : n;
}

/* Sender display name: no quotes, angle brackets or line breaks. */
export const senderName = (v) => String(v || "").replace(/[\p{Cc}"<>\\]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 64);

export function propertyBrand(t) {
  const theme = t && t.booking_theme && typeof t.booking_theme === "object" ? t.booking_theme : {};
  const color = isHex(theme.colors && theme.colors.brand) ? theme.colors.brand.toLowerCase()
    : PRESET_BRAND[theme.preset] || PRESET_BRAND.meadow;
  const replyTo = cleanEmail(t && t.contact_email) || cleanEmail(t && t.booking_email) || cleanEmail(t && t.enquiry_email);
  const place = [t && t.address_line1, [t && t.city, t && t.state].filter(Boolean).join(", "), t && t.postcode]
    .map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
  return {
    name: senderName(t && t.name) || "Your property",
    logo: httpsUrl(t && t.logo_url),
    color,
    ink: onColor(color),
    // Links sit on the light footer: the brand color only if it reads there.
    link: contrast(color, "#f6f8f7") >= 4.5 ? color : "#33413f",
    replyTo,
    phone: String((t && (t.contact_phone || t.phone)) || "").trim().slice(0, 40),
    place: place.slice(0, 200),
    website: httpsUrl(t && t.website_url)
  };
}
