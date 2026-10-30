import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize } from "../../lib/categorize.js";

test("categorizes a grocery-looking description", () => {
  assert.strictEqual(categorize("Shwapno Supermarket"), "Groceries");
});

test("categorizes a bKash transfer description", () => {
  assert.strictEqual(categorize("bKash Send Money"), "Transfer");
});

test("categorizes a rent-looking description", () => {
  assert.strictEqual(categorize("Monthly rent payment"), "Housing");
});

test("falls back to Other when nothing matches", () => {
  assert.strictEqual(categorize("xyz123"), "Other");
});

test("matching is case-insensitive", () => {
  assert.strictEqual(categorize("BKASH topup"), "Transfer");
});
