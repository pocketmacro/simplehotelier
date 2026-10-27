// Focused test: team invites are stored, emailed, and claimed on account setup.
// Run: node --test tests/invites.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261111000000_invites.sql", import.meta.url), "utf8");
const sendEmail = readFileSync(new URL("../supabase/functions/send-email/index.ts", import.meta.url), "utf8");
const acceptPath = new URL("../supabase/functions/accept-invite/index.ts", import.meta.url);
const accept = existsSync(acceptPath) ? readFileSync(acceptPath, "utf8") : "";
const auth = readFileSync(new URL("../js/auth.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

test("invites are stored per property with role and token", () => {
  assert.match(migration, /create table if not exists public\.invites/);
  assert.match(migration, /role text not null default 'cleaner'/);
  assert.match(migration, /idx_invites_pending_email/);
});

test("invite send requires property membership and emails a token link", () => {
  assert.match(sendEmail, /action === "team_invite"/);
  assert.match(sendEmail, /Only property team members can send invites/);
  assert.match(sendEmail, /app\.html\?invite=\$\{invite\.token\}/);
});

test("accept-invite joins by token or account email and marks acceptance", () => {
  assert.match(accept, /tenant_members/);
  assert.match(accept, /accepted_at: new Date\(\)\.toISOString\(\)/);
  assert.match(accept, /This invite was sent to/);
});

test("invitee account setup skips property creation and billing", () => {
  assert.match(auth, /sh_invite_token/);
  assert.match(auth, /Create free account & join/);
  assert.match(auth, /if \(invited\) \{ enterApp\(sessionUser\(\)\); return; \}/);
  assert.match(app, /async function tryClaimInvite\(\)/);
  assert.match(app, /fnInvoke\("accept-invite"/);
});
