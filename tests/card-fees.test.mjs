// Focused test: who pays Stripe's card fee on guest payments.
// Risk covered: guest payments were destination charges with no application
// fee, so SimpleHotelier paid Stripe's 2.9% + 30¢ on every guest payment.
// Now the property pays it (an application fee that covers exactly Stripe's
// fee), and by default passes it to the guest as a card processing fee
// (capped at 3%, shown before paying, refunded in proportion), so the guest
// pays and the property still receives the full amount.
// Run: node --test tests/card-fees.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARD_FEE, cardCharge, refundFee, stripeFee } from "../supabase/functions/_shared/card-fee.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const charge = read("supabase/functions/charge-guest/index.ts");
const hook = read("supabase/functions/stripe-webhook/index.ts");
const daily = read("supabase/functions/daily-jobs/index.ts");
const book = read("js/book.js");
const sql = read("supabase/migrations/20261130000000_card_fees.sql");

// The browser copy in js/money.js, run as the page runs it.
const browser = (() => {
  const window = {};
  new Function("window", "Intl", read("js/money.js"))(window, Intl);
  return window.SHMoney;
})();

test("guest mode: the guest pays the fee and the property nets the full amount", () => {
  for (const amount of [250000, 300000, 1234567]) { // above ~$2,400 the 3% cap doesn't bite
    const c = cardCharge(amount);
    assert.equal(c.total_cents, amount + c.fee_cents);
    assert.equal(c.total_cents - c.application_fee_cents, amount, `$${amount / 100}: property receives every cent`);
  }
});

test("the guest's fee never passes 3%; past the cap the property covers the rest", () => {
  for (const amount of [50, 999, 10000, 25000, 100000]) {
    const c = cardCharge(amount);
    assert.ok(c.fee_cents <= Math.floor(amount * 0.03), `$${amount / 100}`);
    assert.ok(c.total_cents - c.application_fee_cents >= amount - 31, "past the cap the property covers about 30¢");
  }
  assert.deepEqual(cardCharge(10000), { amount_cents: 10000, fee_cents: 300, total_cents: 10300, application_fee_cents: 329 });
});

test("property mode: no fee for the guest; the property pays Stripe's fee", () => {
  const c = cardCharge(10000, "property");
  assert.equal(c.fee_cents, 0);
  assert.equal(c.total_cents, 10000);
  assert.equal(c.application_fee_cents, stripeFee(10000));
});

test("the platform keeps exactly Stripe's fee, never more than the charge", () => {
  for (const mode of ["guest", "property"]) {
    for (const amount of [50, 51, 333, 10000, 98765, 500000]) {
      const c = cardCharge(amount, mode);
      assert.equal(c.application_fee_cents, Math.min(c.total_cents, Math.round(c.total_cents * 0.029 + 30)));
    }
  }
  assert.deepEqual(CARD_FEE, { percent: 2.9, fixedCents: 30, maxPercent: 3 });
});

test("the booking page and dashboard preview the same fee the server charges", () => {
  assert.deepEqual(browser.CARD_FEE, CARD_FEE);
  for (const mode of ["guest", "property", undefined]) {
    for (let amount = 0; amount <= 400000; amount += 997) {
      const s = cardCharge(amount, mode), b = browser.cardCharge(amount, mode);
      assert.equal(b.fee_cents, s.fee_cents, `${mode} ${amount}`);
      assert.equal(b.total_cents, s.total_cents);
    }
  }
});

test("refunds return the card fee in proportion, and the last one returns what's left", () => {
  const pay = { amount_cents: 10000, fee_cents: 300 };
  assert.equal(refundFee(pay, 10000), 300, "full refund");
  const a = refundFee(pay, 3333), b = refundFee(pay, 3333, 3333, a), c = refundFee(pay, 3334, 6666, a + b);
  assert.equal(a + b + c, 300, "partial refunds add up to the whole fee");
  assert.equal(refundFee({ amount_cents: 10000, fee_cents: 0 }, 5000), 0, "no fee, nothing extra");
});

test("every guest charge carries the fee split; the booking is credited without the fee", () => {
  assert.match(charge, /import \{ cardCharge, refundFee \} from "\.\.\/_shared\/card-fee\.js";/);
  assert.equal((charge.match(/const split = cardCharge\(amount, feeMode\(tenant, body\)\);/g) || []).length, 3, "deposit, card on file, payment link");
  assert.match(charge, /return body\.show_fee === true \? tenant\.card_fee_mode : "property";/, "no fee for a page that doesn't show it");
  assert.match(book, /reservation_id: b\.resId, show_fee: true \}/);
  assert.equal((read("js/reservation.js").match(/show_fee: true/g) || []).length, 2);
  assert.equal((charge.match(/application_fee_amount: split\.application_fee_cents/g) || []).length, 3);
  assert.equal((charge.match(/fee_cents: String\(split\.fee_cents\)/g) || []).length, 3, "the fee rides in the intent's metadata");
  assert.match(charge, /amount: split\.total_cents,/);
  assert.match(charge, /name: "Card processing fee"/, "payment links show the fee as its own line");
  assert.match(charge, /select\("id, name, slug, currency, card_fee_mode,/);
  for (const src of [charge, hook]) {
    assert.match(src, /p_amount_cents: \(intent\.amount_received \|\| intent\.amount\) - fee,/);
    assert.match(src, /p_fee_cents: fee,/);
  }
});

test("dashboard refunds add the fee share; Stripe Dashboard refunds are split in SQL", () => {
  assert.match(charge, /const fee = refundFee\(txn, amount, refunded, feeRefunded\);/);
  assert.match(charge, /amount: amount \+ fee,\s+reverse_transfer: true/);
  assert.match(charge, /p_amount_cents: amount \+ fee \}\)/);
  assert.match(sql, /v_amt := round\(p_amount_cents::numeric \* v_orig\.amount_cents \/ \(v_orig\.amount_cents \+ v_orig\.fee_cents\)\);/);
  assert.match(sql, /update public\.reservations set paid_cents = paid_cents - v_amt/, "only the booking part comes off the balance");
});

test("the migration adds the setting, fee columns and the new recorder signature", () => {
  assert.match(sql, /card_fee_mode text not null default 'guest'\s+check \(card_fee_mode in \('guest', 'property'\)\)/);
  assert.match(sql, /grant select \(card_fee_mode\) on public\.tenants to anon, authenticated;/, "the booking page reads it");
  assert.match(sql, /add column if not exists fee_cents int not null default 0/);
  assert.match(sql, /drop function if exists public\.record_stripe_payment\(text, uuid, int, text, text\);/);
  assert.match(sql, /revoke execute on function public\.record_stripe_payment\(text, uuid, int, text, text, int\) from public, anon, authenticated;/);
});

test("daily-jobs settles Stripe's actual fee with the property, once per payment", () => {
  assert.match(daily, /await settleCardFees\(out\);/);
  assert.match(daily, /const diff = bt\.fee - fee\.amount;/);
  assert.match(daily, /stripe\.transfers\.createReversal\(tr\.id,/, "a shortfall comes from that payment's transfer");
  assert.match(daily, /metadata: \{ kind: "card_fee_shortfall"/);
  assert.match(daily, /idempotencyKey: "card-fee-shortfall-" \+ ch\.id/);
  assert.match(daily, /stripe\.applicationFees\.createRefund\(fee\.id,/, "an over-estimate goes back to the property");
  assert.match(daily, /fee_settled_at: new Date\(\)\.toISOString\(\)/);
});

test("the booking page shows the fee before paying and includes it in the total", () => {
  const src = book.slice(book.indexOf("function depositInfo(total) {"), book.indexOf("async function fnPost("));
  const state = { tenant: { deposit_enabled: true, deposit_percent: 25, stripe_onboarding_complete: true, stripe_account_id: "acct_1", card_fee_mode: "guest" } };
  const depositInfo = new Function("state", "cfg", "SHMoney", "round2", src + "\nreturn depositInfo;")(
    state, { STRIPE_PUBLISHABLE_KEY: "pk_test" }, browser, (n) => Math.round(n * 100) / 100);
  assert.deepEqual(depositInfo(400), { pct: 25, due: 100, fee: 3, charge: 103, collectible: true });
  state.tenant.card_fee_mode = "property";
  assert.equal(depositInfo(400).fee, 0);
  assert.match(book, /Card processing fee<small>On today's card payment<\/small>/);
  assert.match(book, /<span>Total<\/span><b>\$\{money\(round2\(q\.total \+ \(dep \? dep\.fee : 0\)\)\)\}<\/b>/);
  assert.match(book, /"Book & pay " \+ money\(dep\.charge\)/);
  assert.match(book, /const tenantCols = "id,name,slug,card_fee_mode,/);
});

test("owners choose in Booking Page settings; the Terms say who pays", () => {
  assert.match(read("app.html"), /id="bkCardFee" checked/);
  assert.match(read("js/app.js"), /card_fee_mode: \$\("#bkCardFee"\)\.checked \? "guest" : "property"/);
  assert.match(read("terms.html"), /Stripe's processing fee on each guest payment is yours/);
});
