import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertBalanced } from "../../src/domain/ledger.js";
import { SinglePostingTransactionError, UnbalancedTransactionError } from "../../src/domain/errors.js";

describe("assertBalanced", () => {
  it("accepts a balanced two-leg transfer", () => {
    assert.doesNotThrow(() =>
      assertBalanced([
        { accountId: "a", amountMinorUnits: -500n, currency: "BDT" },
        { accountId: "b", amountMinorUnits: 500n, currency: "BDT" },
      ]),
    );
  });

  it("accepts a balanced multi-leg transaction (e.g. a payment plus a fee)", () => {
    assert.doesNotThrow(() =>
      assertBalanced([
        { accountId: "customer", amountMinorUnits: -1000n, currency: "BDT" },
        { accountId: "merchant", amountMinorUnits: 975n, currency: "BDT" },
        { accountId: "fee-revenue", amountMinorUnits: 25n, currency: "BDT" },
      ]),
    );
  });

  it("rejects a transaction with only one posting", () => {
    assert.throws(
      () => assertBalanced([{ accountId: "a", amountMinorUnits: 100n, currency: "BDT" }]),
      SinglePostingTransactionError,
    );
  });

  it("rejects a transaction that does not net to zero", () => {
    assert.throws(
      () =>
        assertBalanced([
          { accountId: "a", amountMinorUnits: -500n, currency: "BDT" },
          { accountId: "b", amountMinorUnits: 400n, currency: "BDT" },
        ]),
      UnbalancedTransactionError,
    );
  });

  it("checks balance independently per currency", () => {
    assert.doesNotThrow(() =>
      assertBalanced([
        { accountId: "a", amountMinorUnits: -500n, currency: "BDT" },
        { accountId: "b", amountMinorUnits: 500n, currency: "BDT" },
        { accountId: "c", amountMinorUnits: -100n, currency: "USD" },
        { accountId: "d", amountMinorUnits: 100n, currency: "USD" },
      ]),
    );

    assert.throws(
      () =>
        assertBalanced([
          { accountId: "a", amountMinorUnits: -500n, currency: "BDT" },
          { accountId: "b", amountMinorUnits: 500n, currency: "BDT" },
          { accountId: "c", amountMinorUnits: -100n, currency: "USD" },
          { accountId: "d", amountMinorUnits: 99n, currency: "USD" },
        ]),
      UnbalancedTransactionError,
    );
  });
});
