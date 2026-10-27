// Focused test: demo sessions get no Support access.
// Demo must not call the paid support-ai function (spam/cost) and must not
// create support cases. The edge function already 401s anonymous callers;
// this pins the client gate so the demo never even tries.
// Run: node --test tests/support-demo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const support = readFileSync(new URL("../js/support.js", import.meta.url), "utf8");
const fn = readFileSync(new URL("../supabase/functions/support-ai/index.ts", import.meta.url), "utf8");

// --- Minimal DOM so support.js runs its wire-up in demo mode ---
const els = {};
function stubEl(id) {
  return {
    id, value: id === "#chatInput" ? "How do I add a cabin?" : "", disabled: false, hidden: true,
    innerHTML: "", textContent: "", scrollTop: 0, scrollHeight: 0, dataset: {},
    listeners: {}, children: [],
    addEventListener(type, cb) { this.listeners[type] = cb; },
    appendChild(c) { this.children.push(c); },
    focus() {}, closest() { return null; }
  };
}
const $ = (s) => (els[s] ||= stubEl(s));
globalThis.window = { SH_CONFIG: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon-key" }, addEventListener: () => {} };
globalThis.document = {
  querySelector: (s) => $(s),
  querySelectorAll: () => [],
  createElement: () => stubEl("created"),
  addEventListener: () => {}
};
globalThis.location = { search: "", protocol: "https:", origin: "https://example.com" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: (k) => (k === "sh_demo" ? "1" : null), setItem: () => {}, removeItem: () => {} };
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; return { ok: false, status: 401, json: async () => ({}) }; };
globalThis.toast = () => {};
globalThis.openModal = () => {};
globalThis.closeModal = () => {};
globalThis.goto = () => {};

eval(support);

test("demo disables the Spark chat and case form controls", () => {
  assert.equal($("#chatInput").disabled, true);
  assert.equal($("#chatAsk").disabled, true);
  assert.equal($("#caseSubject").disabled, true);
  assert.equal($("#caseBody").disabled, true);
  assert.equal($("#createCaseBtn").disabled, true);
  assert.equal($("#supportDemoNotice").hidden, false, "demo notice must be visible on the Support view");
});

test("asking Spark in demo makes no network call to the paid AI", async () => {
  const before = fetchCalls;
  const click = $("#chatAsk").listeners.click;
  assert.equal(typeof click, "function", "Ask button handler not wired");
  await click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fetchCalls, before, "demo must not call support-ai");
});

test("server keeps rejecting unauthenticated support-ai calls", () => {
  assert.match(fn, /if \(!user\) return json\(\{ error: "not signed in" \}, 401\)/);
});
