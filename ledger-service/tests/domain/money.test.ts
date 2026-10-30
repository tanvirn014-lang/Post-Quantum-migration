import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../src/domain/money.js";

describe("Money", () => {
  it("adds and subtracts in the same currency", () => {
    const a = Money.of(1000n, "bdt");
    const b = Money.of(250n, "BDT");
    assert.strictEqual(a.add(b).minorUnits, 1250n);
    assert.strictEqual(a.subtract(b).minorUnits, 750n);
  });

  it("normalizes currency codes to uppercase", () => {
    assert.strictEqual(Money.of(100n, "bdt").currency, "BDT");
  });

  it("rejects an invalid currency code", () => {
    assert.throws(() => Money.of(100n, "taka"));
    assert.throws(() => Money.of(100n, "1DT"));
  });

  it("refuses to mix currencies", () => {
    const bdt = Money.of(100n, "BDT");
    const usd = Money.of(100n, "USD");
    assert.throws(() => bdt.add(usd), /currency mismatch/i);
  });

  it("never uses floating point", () => {
    // The classic float trap: 0.1 + 0.2 !== 0.3 in IEEE 754. In minor units this is exact.
    const a = Money.of(10n, "BDT");
    const b = Money.of(20n, "BDT");
    assert.strictEqual(a.add(b).equals(Money.of(30n, "BDT")), true);
  });

  it("negates and reports sign correctly", () => {
    const m = Money.of(500n, "BDT");
    assert.strictEqual(m.negate().isNegative(), true);
    assert.strictEqual(Money.zero("BDT").isZero(), true);
  });
});
