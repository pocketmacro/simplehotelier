// Focused test: the Booking Page studio must show the signed-in property's
// own name and page address, not the demo defaults baked into app.html.
// Regression: loadLiveIntoUI restored headline/colors/GA but never #bkName
// or #bkUrl, so other accounts saw "Pinecrest Cabins" /
// pinecrest.simplehotelier.com — and Publish would have saved those over
// their real name/slug.
// Run: node --test tests/booking-studio-restore.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

test("live load restores property name and page address into the studio", () => {
  const restore = app.slice(app.indexOf('if ($("#bkGa"))'), app.indexOf('if ($("#pfName"))'));
  assert.ok(restore.length > 0, "studio restore block not found");
  assert.match(restore, /\$\("#bkName"\)\.value = live\.tenant\.name/);
  assert.match(restore, /\$\("#bkUrl"\)\.value = live\.tenant\.slug \+ "\.simplehotelier\.com"/);
  assert.match(restore, /\$\("#bkUrlPrev"\)\.textContent = live\.tenant\.slug \+ "\.simplehotelier\.com"/);
  assert.match(restore, /setPreviewSrc\(\);/, "the live preview loads the property's own page");
});

test("studio preview never appends the demo location", () => {
  assert.doesNotMatch(app, /ESTES PARK/);
});
