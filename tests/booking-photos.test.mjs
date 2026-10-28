// Focused test: room cards on the booking page with several photos are a
// slideshow (left/right arrows, "2 / 5", swipe on touch screens).
// Risks covered: arrows on a card with one photo, an arrow pointing past the
// first or last photo, a re-render (picking dates, guests, a room) jumping
// back to the first photo, an arrow click selecting the room, and photo
// URLs breaking out of the markup.
// Run: node --test tests/booking-photos.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const book = read("js/book.js");
const css = read("css/book.css");

/* roomCard + the slideshow helpers from js/book.js, with simple stand-ins. */
const preloaded = [];
const src = book.match(/  const chevron = [^\n]+\n/)[0]
  + book.slice(book.indexOf("  /* Photo slideshows on the cards"), book.indexOf("  function typeFacts("))
  + book.match(/  function roomCard\([\s\S]*?\n  \}\n/)[0];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = new Function("esc", "nights", "guestsCount", "cancelDeadline", "price", "money", "plural", "HOUSE_SVG", "CHECK_SVG", "Image",
  src + "\nreturn { roomCard, showPhoto, gallery, photoAt };")(
  esc, () => 2, () => 2, () => "", (n) => "$" + n, (n) => "$" + n, (n, a, b) => n + " " + (n === 1 ? a : b), "<svg/>", "<svg/>",
  class { set src(v) { preloaded.push(v); } });
const card = (key, photos) => S.roomCard({ key, keyAttr: "data-room", name: "Luxury Cabin", facts: [], desc: "", photos, feats: [],
  rate: 295, stayTotal: 590, tag: "", tagLow: false, sel: false, booked: false, capacity: 6, plan: null, problem: "" });
const arrows = (html) => ({
  prev: /class="bk-ph-nav prev"[^>]*aria-label="Previous photo"( hidden)?>/.exec(html),
  next: /class="bk-ph-nav next"[^>]*aria-label="Next photo"( hidden)?>/.exec(html),
  count: (/<span class="bk-photos">([^<]*)<\/span>/.exec(html) || [])[1]
});

test("one photo: no arrows, no counter", () => {
  const html = card("r1", ["https://img.example/a.jpg"]);
  assert.doesNotMatch(html, /bk-ph-nav|bk-photos|data-card/);
  assert.match(html, /<img src="https:\/\/img\.example\/a\.jpg" alt="Luxury Cabin" loading="lazy">/);
});

test("several photos: only the arrows that lead somewhere, and where you are", () => {
  const photos = ["https://img.example/a.jpg", "https://img.example/b.jpg", "https://img.example/c.jpg"];
  let a = arrows(card("r2", photos));
  assert.ok(a.prev && a.prev[1], "first photo: left arrow hidden");
  assert.ok(a.next && !a.next[1], "right arrow shown");
  assert.equal(a.count, "1 / 3");

  S.photoAt.r2 = 1; // the guest went to photo 2, then the cards re-rendered
  const html = card("r2", photos);
  a = arrows(html);
  assert.ok(!a.prev[1] && !a.next[1], "middle photo: both arrows");
  assert.equal(a.count, "2 / 3");
  assert.match(html, /<img src="https:\/\/img\.example\/b\.jpg" alt="Luxury Cabin, photo 2 of 3"/, "still on photo 2");

  S.photoAt.r2 = 2;
  a = arrows(card("r2", photos));
  assert.ok(!a.prev[1] && a.next[1], "last photo: right arrow hidden");
  S.photoAt.r2 = 9; // the owner removed photos since
  assert.equal(arrows(card("r2", photos)).count, "3 / 3");
});

test("arrows change the photo in place, never past either end", () => {
  card("r3", ["https://img.example/a.jpg", "https://img.example/b.jpg"]);
  const el = () => ({ hidden: false });
  const parts = { img: { src: "", alt: "" }, ".bk-ph-nav.prev": el(), ".bk-ph-nav.next": el(), ".bk-photos": { textContent: "" } };
  const media = { dataset: { card: "r3" }, querySelector: (s) => parts[s] };
  S.photoAt.r3 = 0;
  S.showPhoto(media, 1);
  assert.equal(parts.img.src, "https://img.example/b.jpg");
  assert.equal(parts.img.alt, "Luxury Cabin, photo 2 of 2");
  assert.equal(parts[".bk-photos"].textContent, "2 / 2");
  assert.deepEqual([parts[".bk-ph-nav.prev"].hidden, parts[".bk-ph-nav.next"].hidden], [false, true]);
  S.showPhoto(media, 2);
  assert.equal(S.photoAt.r3, 1, "stays on the last photo");
  S.showPhoto(media, -1);
  assert.equal(S.photoAt.r3, 0, "stays on the first photo");
  assert.equal(preloaded.at(-1), "https://img.example/b.jpg", "the next photo is fetched ahead");
});

test("photo URLs and names can't break out of the card", () => {
  const html = card("r4", ['https://img.example/x.jpg"><script>alert(1)</script>', "https://img.example/y.jpg"]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /x\.jpg&quot;&gt;&lt;script&gt;/);
});

test("clicks and swipes", () => {
  const click = book.slice(book.indexOf('$("#roomsList").addEventListener("click"'), book.indexOf("function syncDateMins()"));
  assert.ok(click.indexOf('closest("[data-photo]")') < click.indexOf('closest("[data-type]")'), "an arrow never selects the room");
  assert.match(click, /if \(nav\.hidden\) media\.querySelector\("\.bk-ph-nav:not\(\[hidden\]\)"\)\.focus\(\);/, "keyboard focus stays on the card");
  assert.match(click, /Math\.abs\(dx\) > 40 && Math\.abs\(dx\) > 1\.5 \* Math\.abs\(dy\)/, "sideways swipes only; scrolling still scrolls");
  assert.match(css, /\.bk-room-media\[data-card\] \{ touch-action: pan-y pinch-zoom; \}/);
  // Translucent white over the photo, solid on hover (and keyboard focus).
  assert.match(css, /\.bk-ph-nav \{[^}]*background: rgb\(255 255 255 \/ 72%\)/);
  assert.match(css, /\.bk-ph-nav:hover, \.bk-ph-nav:focus-visible \{ background: #fff;/);
});
