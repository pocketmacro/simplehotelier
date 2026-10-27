// Focused test: System Admin is super-admin only (nav hidden + data guarded).
// Regression: .nav-btn { display:flex } silently overrode the hidden attribute,
// so the System Admin page showed for every account.
// Run: node --test tests/admin-visibility.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appCss = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const support = readFileSync(new URL("../js/support.js", import.meta.url), "utf8");

test("hidden attribute wins over component display rules", () => {
  assert.match(appCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test("admin nav starts hidden and is only unhidden by the admin check", () => {
  assert.match(html, /id="navAdmin"[^>]*\bhidden\b/);
  assert.match(support, /nav\.hidden = !is/);
});

test("admin data load refuses non-admins even if reached directly", () => {
  const guard = support.indexOf("if (!adminVerified)");
  const fetchData = support.indexOf("SHDB.adminSubscribers()");
  assert.ok(guard > -1 && fetchData > -1 && guard < fetchData, "loadAdmin must verify isSystemAdmin before loading subscribers");
});
