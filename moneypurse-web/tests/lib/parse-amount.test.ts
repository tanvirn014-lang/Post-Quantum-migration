import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAmountToMinorUnits } from "../../lib/format.js";

describe("parseAmountToMinorUnits", () => {
  it("converts whole and fractional amounts to minor units without floating point", () => {
    assert.strictEqual(parseAmountToMinorUnits("1250"), "125000");
    assert.strictEqual(parseAmountToMinorUnits("1250.5"), "125050");
    assert.strictEqual(parseAmountToMinorUnits("0.99"), "99");
    assert.strictEqual(parseAmountToMinorUnits("0.07"), "7");
    assert.strictEqual(parseAmountToMinorUnits(" 1,250.00 "), "125000");
    // Float traps such as 19.99 * 100 = 1998.9999999999998 cannot occur: no float is involved.
    assert.strictEqual(parseAmountToMinorUnits("19.99"), "1999");
  });

  it("rejects zero, negative, empty, malformed and over-precise input", () => {
    for (const bad of ["", "0", "0.00", "-5", "+5", "abc", "1.234", "1.", ".5", "1e3", "1 000", "NaN", "Infinity"]) {
      assert.strictEqual(parseAmountToMinorUnits(bad), null, JSON.stringify(bad));
    }
  });

  it("rejects absurdly large amounts instead of overflowing", () => {
    assert.strictEqual(parseAmountToMinorUnits("9".repeat(14)), null);
    assert.ok(parseAmountToMinorUnits("9999999999999.99") !== null);
  });
});
