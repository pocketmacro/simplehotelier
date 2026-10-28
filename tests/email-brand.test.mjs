// Focused test: guest emails carry the property's branding and replies go
// to the property. Risks covered: guests saw SimpleHotelier branding and
// replied to a no-reply address; a property name or contact email must not
// be able to inject headers or HTML into the message.
// Run: node --test tests/email-brand.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { propertyBrand, cleanEmail, senderName, onColor } from "../supabase/functions/_shared/brand.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("brand comes from the property: name, logo, booking-page color, contact details", () => {
  const b = propertyBrand({
    name: "Sam's Chicken Ranch", logo_url: "https://cdn.example.com/logo.png", contact_email: "hello@ranch.example",
    contact_phone: "(402) 555-0100", address_line1: "1 Pine Rd", city: "Valentine", state: "NE", postcode: "69201",
    website_url: "https://ranch.example", booking_theme: { preset: "modern", colors: { brand: "#1F6FEB" } }
  });
  assert.equal(b.name, "Sam's Chicken Ranch");
  assert.equal(b.logo, "https://cdn.example.com/logo.png");
  assert.equal(b.color, "#1f6feb");
  assert.equal(b.ink, onColor("#1f6feb"));
  assert.equal(b.replyTo, "hello@ranch.example");
  assert.equal(b.place, "1 Pine Rd · Valentine, NE · 69201");
  assert.equal(b.website, "https://ranch.example/");
});

test("sensible fallbacks: preset color, booking email for replies, no unsafe links", () => {
  const b = propertyBrand({ name: "Pinecrest", booking_email: "desk@pinecrest.example", logo_url: "javascript:alert(1)",
    website_url: "http://insecure.example", booking_theme: { preset: "coastal" } });
  assert.equal(b.color, "#1f5f7a");
  assert.equal(b.replyTo, "desk@pinecrest.example");
  assert.equal(b.logo, "");
  assert.equal(b.website, "");
  assert.equal(propertyBrand({}).color, "#2f5d46", "no theme -> Meadow, the booking page default");
  assert.equal(propertyBrand({ booking_theme: { colors: { brand: "#d4a85a" } } }).link, "#33413f", "light brand colors don't become unreadable links");
});

test("reply-to and sender name can't carry header tricks", () => {
  assert.equal(cleanEmail("a@b.co, victim@x.co"), "");
  assert.equal(cleanEmail("Eve <eve@x.co>"), "");
  assert.equal(cleanEmail("ok@property.example"), "ok@property.example");
  assert.equal(senderName('Bad "Name"\r\nBcc: x@y.z <>'), "Bad Name Bcc: x@y.z");
  assert.ok(senderName("x".repeat(200)).length <= 64);
});

test("guest emails use the property brand and reply-to; owner and team emails stay SimpleHotelier", () => {
  const send = read("supabase/functions/send-email/index.ts");
  assert.match(send, /html: guestHtml,\s+fromName: brand\.name,\s+replyTo: brand\.replyTo/, "booking confirmation");
  assert.match(send, /subject: `Payment receipt[^`]*`,\s+fromName: brand\.name,\s+replyTo: brand\.replyTo,/, "payment receipt");
  assert.match(send, /replyTo: r\.guest_email/, "the property's new-booking alert replies to the guest");
  const charge = read("supabase/functions/charge-guest/index.ts");
  assert.match(charge, /const brand = propertyBrand\(tenant\);\s+const res = await sendMail\(\{\s+to: resv\.guest_email,\s+fromName: brand\.name,\s+replyTo: brand\.replyTo,/);
  assert.match(charge, /p\(button\(session\.url, `Pay \$\{money\(split\.total_cents, tenant\.currency\)\} securely`, brand\)\)/);
  const daily = read("supabase/functions/daily-jobs/index.ts");
  assert.match(daily, /to: r\.guest_email,\s+fromName: brand\.name,\s+replyTo: brand\.replyTo,/, "check-in/check-out reminders");
  const email = read("supabase/functions/_shared/email.ts");
  assert.match(email, /from: \{ name: senderName\(fromName\) \|\| "SimpleHotelier", address: FROM \}/);
  assert.match(email, /const reply = cleanEmail\(replyTo\);/);
  assert.match(email, /\$\{esc\(brand\.name\)\}/, "property name is escaped in the header");
});
