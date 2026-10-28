// Focused test: Your account in the dashboard (display name, login email,
// password) for every role. Risks covered: a password changed without the
// current one, an email change that silently does nothing (it needs links
// opened at both addresses), the emailed links landing on the wrong screen
// or leaving tokens in the address bar, the sidebar still showing the email
// after a name is set, a limited role (cleaner) locked out of their own
// account, and changes nobody is told about.
// Run: node --test tests/account.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("app.html");
const app = read("js/app.js");
const auth = read("js/auth.js");
const css = read("css/app.css");
const emails = read("scripts/set-auth-emails.mjs");
const acct = app.slice(app.indexOf("/* ---------------- Your account"), app.indexOf("/* Demo mode is explicit"));

test("the page: three cards, password-manager friendly", () => {
  const view = html.slice(html.indexOf('<section class="view" id="view-account">'));
  assert.ok(view.length > 0 && view.indexOf("</section>") > 0);
  const page = view.slice(0, view.indexOf("</section>"));
  assert.match(page, /<form class="card card-pad acct-card" id="acctNameForm"[\s\S]*id="acctName" autocomplete="name" maxlength="60"/);
  assert.match(page, /<form class="card card-pad acct-card" id="acctEmailForm"[\s\S]*id="acctEmail" type="email" autocomplete="email"/);
  assert.match(page, /<form class="card card-pad acct-card" id="acctPasswordForm"[\s\S]*id="acctPwUser" type="email" autocomplete="username" hidden readonly>/);
  assert.match(page, /id="acctPwCurrent" type="password" autocomplete="current-password"/);
  assert.equal((page.match(/autocomplete="new-password"/g) || []).length, 2);
  assert.equal((page.match(/<p class="acct-error" role="alert" hidden><\/p>/g) || []).length, 3, "each card says what went wrong");
  assert.match(css, /\.acct-grid \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 300px\), 1fr\)\);/);
});

test("everyone can open it: their name in the sidebar, and Settings", () => {
  assert.match(html, /<button class="user-meta" type="button" data-goto="account" title="Your account: name, email and password"><strong id="userName">/);
  assert.match(html, /<h1>Settings<\/h1>[\s\S]{0,200}<button class="btn btn-ghost btn-sm" type="button" data-goto="account">Your account<\/button>/);
  assert.match(app, /const canSee = \(view\) => [^\n]*\|\| view === "account";/, "cleaners and maintenance too");
  assert.match(app, /if \(view === "account"\) openAccount\(\);/);
});

/* displayName / initials / showUser from js/app.js. */
const names = new Function("$", acct.slice(0, acct.indexOf("function renderAccount()")) + "\nreturn { displayName, initials, showUser };");
test("the sidebar shows the display name and its initials", () => {
  const els = { "#userName": {}, "#userAvatar": {} };
  const N = names((id) => els[id]);
  N.showUser({ email: "sam@pocketmacro.com", user_metadata: { full_name: "  Sam Williams " } });
  assert.deepEqual([els["#userName"].textContent, els["#userAvatar"].textContent], ["Sam Williams", "SW"]);
  N.showUser({ email: "sam@pocketmacro.com", user_metadata: {} });
  assert.deepEqual([els["#userName"].textContent, els["#userAvatar"].textContent], ["sam@pocketmacro.com", "SA"]);
  assert.equal(N.initials({ email: "x@y.z", user_metadata: { full_name: "Cher" } }), "CH");
  assert.match(app, /if \(live\.user\) \{\s+liveUser = live\.user;\s+showUser\(live\.user\);/);
});

test("each card sends only its own change", () => {
  assert.match(acct, /SHAuth\.updateUser\(\{ data: \{ full_name: name \} \}\)/);
  assert.match(acct, /SHAuth\.updateUser\(\{ email \}\)/);
  assert.match(acct, /SHAuth\.updateUser\(\{ password, current_password: current \}\)/, "the current password goes with a new one");
  assert.match(acct, /password\.length < 8 \|\| password\.length > 72/);
  assert.match(acct, /password !== \$\("#acctPwConfirm"\)\.value/);
  assert.match(acct, /email === String\(liveUser\.email\)\.toLowerCase\(\)/, "no pointless change to the same address");
  // Name: no control characters, single spaces, at most 60.
  const clean = new Function("v", "return " + acct.match(/\$\("#acctName"\)\.value(\.replace\([^\n]*?\.slice\(0, 60\))/)[1].replace(/^/, "v"));
  assert.equal(clean("  Sam\t\u0007 Williams  "), "Sam Williams");
  // Known refusals read plainly; anything else is reported as a bug.
  for (const code of ["current_password_mismatch", "same_password", "weak_password", "email_exists", "over_email_send_rate_limit"]) {
    assert.match(acct, new RegExp(code + ": \""), code);
  }
  assert.match(acct, /if \(!known && window\.SHReportError\) window\.SHReportError\(e, "account update"\);/);
  // A pending email change is shown until it's confirmed.
  assert.match(acct, /const pending = !demo && liveUser && liveUser\.new_email;/);
  assert.match(acct, /open both to finish/);
});

/* js/auth.js: updateUser and the emailed links coming back. */
test("auth: error codes, and the email links come back to the app", () => {
  assert.match(auth, /err\.code = data\.error_code \|\| "";/);
  assert.match(auth, /authFetch\("user" \+ \(patch\.email \? redirectParam\(\) : ""\), \{ method: "PUT", body: JSON\.stringify\(patch\) \}, true\)/);
  assert.match(auth, /window\.SHAuth = \{[^}]*currentUser, updateUser, authReturn \};/);
  const take = auth.match(/  function takeAuthReturn\(\) \{[\s\S]*?\n  \}\n/)[0];
  const run = (hash, search = "") => {
    let url = null;
    const location = { hash, search, pathname: "/app" };
    const history = { replaceState: (_s, _t, u) => { url = u; } };
    const back = new Function("location", "history", take + "\nreturn takeAuthReturn();")(location, history);
    return { back, url };
  };
  // First of the two links: no session yet, a message; lands on Your account.
  let r = run("#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email");
  assert.deepEqual(r.back, { type: "email_change_halfway" });
  assert.equal(r.url, "/app#account");
  // Second link: the session, on Your account, tokens out of the address bar.
  r = run("#access_token=AT&refresh_token=RT&type=email_change&expires_in=3600");
  assert.deepEqual(r.back, { type: "email_change", access_token: "AT", refresh_token: "RT" });
  assert.equal(r.url, "/app#account");
  // Others unchanged: a reset link, a plain screen hash.
  r = run("#access_token=AT&refresh_token=RT&type=recovery");
  assert.equal(r.url, "/app");
  assert.equal(run("#reservations").back, null);
  assert.match(auth, /if \(back && \/\^email_change\/\.test\(back\.type\)\) \{\s+returned = \{ type: back\.type \};/);
  assert.match(app, /endBoot\(\); \/\/ after routing[^\n]*\n\s+announceAuthReturn\(\);/);
});

test("auth settings: current password required, changes are reported", () => {
  assert.match(emails, /security_update_password_require_current_password: true,/);
  assert.match(emails, /mailer_notifications_password_changed_enabled: true,/);
  assert.match(emails, /mailer_notifications_email_changed_enabled: true,/);
  // The notices have no button or link to follow.
  assert.match(emails, /mailer_templates_password_changed_notification_content: shell\(\s+"Your password was changed",\s+`[^`]*`,\s+null,/);
  assert.match(emails, /mailer_templates_email_changed_notification_content: shell\(\s+"Your login email was changed",\s+`[^`]*\{\{ \.OldEmail \}\} to \{\{ \.Email \}\}\.`,\s+null,/);
  assert.match(emails, /<\/td><\/tr>\$\{buttonLabel \? `/);
});

test("Spark answers account questions", () => {
  globalThis.window = { SH_CONFIG: {} };
  new Function("window", read("js/site.js"))(globalThis.window);
  const doc = { querySelector: () => null, addEventListener: () => {} };
  new Function("window", "document", "location", "localStorage", read("js/support.js"))(
    globalThis.window, doc, { search: "", protocol: "https:", origin: "https://example.com" }, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const S = globalThis.window.SHSupport;
  for (const q of ["How do I change my password?", "Can I change my login email?", "How do I set my display name?"]) {
    assert.equal(S.answer(q).id, "account", q);
  }
  assert.equal(S.answer("Do guests get a confirmation email?").id, "emails", "guest emails still go to their article");
  assert.deepEqual(S.findLinks("open Your account").map((l) => l.view), ["account"]);
});
