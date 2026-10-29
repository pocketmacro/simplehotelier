// Focused test: the post-booking redirect leaves the embed iframe. The
// thank-you URL must load in the host site's window, never inside the widget.
// Run: node --test tests/embed-redirect.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("js/app.js");
const book = read("js/book.js");
const bookHtml = read("book.html");

// The listener owners paste into their site, run against a fake host page.
const snippet = app.match(/<script>(window\.addEventListener\("message"[\s\S]*?)<\\\/script>/)[1];
function host() {
  const acks = [];
  const frame = { style: {}, contentWindow: { postMessage: (m, o) => acks.push([m, o]) } };
  const page = { handler: null, frame, acks, location: { href: "https://hotel.example/book" } };
  vm.runInNewContext(snippet, {
    window: { addEventListener: (t, fn) => { if (t === "message") page.handler = fn; } },
    document: { getElementById: (id) => (id === "sh-book" ? frame : null) },
    location: page.location
  });
  page.send = (data, source = frame.contentWindow) => page.handler({ data, source, origin: "https://app.simplehotelier.com" });
  return page;
}

test("snippet sends the host page to the thank-you URL and acks the widget", () => {
  const p = host();
  p.send({ type: "simplehotelier:redirect", url: "https://hotel.example/thanks?booking_ref=AB12" });
  assert.equal(p.location.href, "https://hotel.example/thanks?booking_ref=AB12");
  assert.equal(JSON.stringify(p.acks), JSON.stringify([[{ type: "simplehotelier:redirecting" }, "https://app.simplehotelier.com"]]));
});

test("snippet ignores non-web URLs and messages from other frames", () => {
  const p = host();
  p.send({ type: "simplehotelier:redirect", url: "javascript:alert(1)" });
  p.send({ type: "simplehotelier:redirect", url: "data:text/html,hi" });
  p.send({ type: "simplehotelier:redirect", url: "https://evil.example/" }, { postMessage() {} });
  p.send({ type: "simplehotelier:height", height: 9999 }, { postMessage() {} });
  assert.equal(p.location.href, "https://hotel.example/book");
  assert.equal(p.frame.style.height, undefined);
  assert.equal(p.acks.length, 0);
});

test("snippet still auto-resizes the widget", () => {
  const p = host();
  p.send({ type: "simplehotelier:height", height: 812 });
  assert.equal(p.frame.style.height, "812px");
});

test("booking page redirects the top window when framed, not the frame", () => {
  const conv = book.slice(book.indexOf("function trackConversion"), book.indexOf("function nights"));
  assert.match(conv, /framed = window\.top !== window/);
  assert.match(conv, /if \(framed\) \$\("#redirectLink"\)\.target = "_top"/);
  assert.match(conv, /if \(framed\) redirectTop\(url\); else location\.href = url;/);
  // No snippet ack (pasted before the listener existed): navigate top directly.
  assert.match(conv, /window\.parent\.postMessage\(\{ type: "simplehotelier:redirect", url \}, "\*"\)/);
  assert.match(conv, /e\.source === window\.parent && e\.data && e\.data\.type === "simplehotelier:redirecting"\) clearTimeout\(fallback\)/);
  assert.match(conv, /try \{ window\.top\.location\.href = url; \}/);
  assert.match(bookHtml, /<a id="redirectLink" href="#">Continue<\/a>/);
});
