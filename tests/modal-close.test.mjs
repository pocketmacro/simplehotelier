import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const modalModule = app.slice(app.indexOf("Custom modal module"), app.indexOf("/* ---------------- Navigation"));

test("modals do not close when clicking the overlay outside the dialog", () => {
  assert.doesNotMatch(modalModule, /overlay\.addEventListener\("click"/);
  assert.doesNotMatch(modalModule, /e\.target === overlay/);
});

test("modals do not close with the Escape key", () => {
  assert.doesNotMatch(modalModule, /e\.key === "Escape"/);
  assert.doesNotMatch(modalModule, /key === ['"]Escape['"]/);
});

test("modals still close from the X and explicit modal buttons", () => {
  assert.match(modalModule, /class="modal-x" data-close/);
  assert.match(modalModule, /e\.target\.closest\("\[data-close\]"\)\) closeModal\(\)/);
});
