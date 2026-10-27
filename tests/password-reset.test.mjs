// Focused test: password reset (js/auth.js + app.html).
// Risk covered: there was no way to recover a forgotten password, so an
// owner or invitee who forgot theirs was locked out for good. Now "Forgot
// password?" sends Supabase Auth's reset email back to the app; the link's
// session is held in memory (never loads the app) until a new password is
// saved; tokens are stripped from the address bar; expired links explain
// themselves. The request never reveals whether an email has an account.
// Run: node --test tests/password-reset.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const auth = read("js/auth.js");
const html = read("app.html");

// Run the real link parser against return URLs shaped like Supabase Auth's.
const src = auth.slice(auth.indexOf("function takeAuthReturn()"), auth.indexOf("  // A reset link's session"));
function parse(url) {
  const u = new URL(url);
  const replaced = [];
  const location = { hash: u.hash, search: u.search, pathname: u.pathname };
  const history = { replaceState: (_s, _t, to) => replaced.push(to) };
  const out = new Function("location", "history", src + "\nreturn takeAuthReturn();")(location, history);
  return { out, replaced };
}

test("a reset link's tokens are read and stripped from the address bar", () => {
  const { out, replaced } = parse("https://simplehotelier.com/app.html#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer&type=recovery");
  assert.deepEqual(out, { type: "recovery", access_token: "AAA", refresh_token: "RRR" });
  assert.deepEqual(replaced, ["/app.html"]);
});

test("an expired link reports its error code; other query params survive", () => {
  const { out, replaced } = parse("https://simplehotelier.com/app.html?invite=abc#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.deepEqual(out, { error: "otp_expired" });
  assert.deepEqual(replaced, ["/app.html?invite=abc"]);
});

test("ordinary page loads are left alone", () => {
  for (const url of ["https://simplehotelier.com/app.html", "https://simplehotelier.com/app.html#login", "https://simplehotelier.com/app.html?invite=abc"]) {
    const { out, replaced } = parse(url);
    assert.equal(out, null, url);
    assert.deepEqual(replaced, [], url);
  }
});

test("the reset request goes back to this page and never reveals accounts", () => {
  assert.match(auth, /await authFetch\("recover" \+ redirectParam\(\), \{ method: "POST", body: JSON\.stringify\(\{ email \}\) \}\);/);
  assert.match(auth, /authFetch\("signup" \+ redirectParam\(\)/, "signup shares the same redirect");
  assert.match(auth, /showNote\(`If \$\{email\} has a SimpleHotelier account, a reset link is on its way\./);
  assert.match(auth, /\/rate limit\|security purposes\|429\/i\.test\(err\.message\)/);
});

test("a reset link signs out any other account and holds its session until the password is saved", () => {
  const block = auth.slice(auth.indexOf('if (back && back.type === "recovery")'), auth.indexOf("// Email confirmation (and other emailed sign-in links)"));
  assert.match(block, /clearSession\(\);\s+recovery = back;/);
  assert.doesNotMatch(block, /saveSession/, "the app never loads on a reset link before the new password");
  assert.match(block, /setTab\("reset"\);/);
  assert.match(block, /\$\("#rpSubmit"\)\.disabled = false;/, "submit unlocks only once the link checks out");
  // Saved: PUT /user with the link's token, then the session, then the app.
  assert.match(auth, /authFetch\("user", \{\s+method: "PUT", headers: \{ Authorization: "Bearer " \+ recovery\.access_token \}, body: JSON\.stringify\(\{ password \}\)\s+\}\);\s+saveSession\(\{ access_token: recovery\.access_token, refresh_token: recovery\.refresh_token, user \}\);\s+recovery = null;/);
  assert.match(auth, /if \(password !== \$\("#rpConfirm"\)\.value\)/);
  assert.match(auth, /if \(password\.length < 8 \|\| password\.length > 72\)/);
});

test("email links are handled before demo mode and session restore", () => {
  const i = (s) => auth.indexOf(s);
  assert.ok(i("const back = takeAuthReturn();") < i("if (demoChosen() && !accessToken())"));
  assert.ok(i("if (demoChosen() && !accessToken())") < i("// Returning session? Validate"));
  assert.match(auth, /if \(recovery\) return; \/\/ a password reset link is on screen/);
});

test("the sign-in page has the forgot and reset forms", () => {
  assert.match(html, /<button class="drawer-link" id="toForgot" type="button">Forgot password\?<\/button>/);
  assert.match(html, /<form id="forgotForm" hidden>/);
  assert.match(html, /<form id="resetForm" hidden>/);
  assert.match(html, /id="rpPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="72"/);
  assert.match(html, /<input id="rpUser" type="email" autocomplete="username" hidden readonly>/, "password managers file it under the right account");
  assert.match(html, /<div class="auth-note" id="authNote" role="status" hidden><\/div>/);
});

test("the sign-up confirmation note survives the tab switch", () => {
  assert.match(auth, /setTab\("login"\);\s+\$\("#liEmail"\)\.value = \$\("#suEmail"\)\.value\.trim\(\);\s+showNote\("Account created\./);
});
