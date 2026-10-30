import { test } from "node:test";
import assert from "node:assert/strict";
import { isLowBalance } from "../../lib/low-balance.js";

test("true when balance is below the threshold", () => {
  assert.strictEqual(isLowBalance("500", "1000"), true);
});

test("false when balance equals the threshold", () => {
  assert.strictEqual(isLowBalance("1000", "1000"), false);
});

test("false when balance is above the threshold", () => {
  assert.strictEqual(isLowBalance("1500", "1000"), false);
});

test("true for a negative (overdrawn) balance against any positive threshold", () => {
  assert.strictEqual(isLowBalance("-100", "1000"), true);
});
