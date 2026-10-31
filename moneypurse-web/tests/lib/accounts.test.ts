import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Account } from "../../lib/api/types.js";
import { accountLabels, customerFacingAccounts, lowBalanceAccounts, totalBalance } from "../../lib/accounts.js";
import { account } from "../helpers/render.js";

const acc = (overrides: Record<string, unknown>) => account(overrides) as Account;

describe("account helpers", () => {
  it("hides settlement accounts from customer-facing views", () => {
    const list = [acc({ id: "a", kind: "current" }), acc({ id: "b", kind: "settlement" }), acc({ id: "c", kind: "savings" })];
    assert.deepStrictEqual(customerFacingAccounts(list).map((a) => a.id), ["a", "c"]);
  });

  it("labels accounts by kind and numbers them only when a kind repeats", () => {
    const labels = accountLabels([acc({ id: "a", kind: "current" }), acc({ id: "b", kind: "savings" }), acc({ id: "c", kind: "savings" })]);
    assert.strictEqual(labels.get("a"), "Current");
    assert.strictEqual(labels.get("b"), "Savings 1");
    assert.strictEqual(labels.get("c"), "Savings 2");
  });

  it("handles zero accounts", () => {
    assert.strictEqual(accountLabels([]).size, 0);
    assert.strictEqual(totalBalance([]), null);
  });

  it("totals balances in bigint minor units", () => {
    const total = totalBalance([acc({ balanceMinorUnits: "9007199254740993" }), acc({ balanceMinorUnits: "7" })]);
    assert.deepStrictEqual(total, { minorUnits: "9007199254741000", currency: "BDT" });
  });

  it("refuses to total mixed currencies", () => {
    assert.strictEqual(totalBalance([acc({ currency: "BDT" }), acc({ currency: "USD" })]), null);
  });

  it("flags only active current accounts below the threshold, using exact comparison", () => {
    const list = [
      acc({ id: "low", kind: "current", balanceMinorUnits: "99999" }),
      acc({ id: "edge", kind: "current", balanceMinorUnits: "100000" }),
      acc({ id: "savings-low", kind: "savings", balanceMinorUnits: "1" }),
      acc({ id: "frozen-low", kind: "current", balanceMinorUnits: "1", status: "frozen" }),
      acc({ id: "overdrawn", kind: "current", balanceMinorUnits: "-500" }),
    ];
    assert.deepStrictEqual(lowBalanceAccounts(list).map((a) => a.id), ["low", "overdrawn"]);
  });
});
