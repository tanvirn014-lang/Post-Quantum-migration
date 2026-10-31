import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DECISION_LABEL,
  decisionTone,
  formatGroupCode,
  formatMs,
  formatTimeToApply,
  keyExchangeTone,
  normalizeFingerprint,
  severityTone,
  shortFingerprint,
} from "../../lib/security-format.js";

describe("security console formatting", () => {
  it("normalizes certificate fingerprints in the forms tools print", () => {
    const hex = "ab".repeat(32);
    assert.strictEqual(normalizeFingerprint(hex), hex);
    assert.strictEqual(normalizeFingerprint(hex.toUpperCase().match(/../g)!.join(":")), hex);
    assert.strictEqual(normalizeFingerprint(`  ${hex}  `), hex);
  });

  it("rejects anything that is not exactly a SHA-256 fingerprint", () => {
    for (const bad of ["", "abc", "zz".repeat(32), "ab".repeat(31), "ab".repeat(33), "ab:cd"]) assert.strictEqual(normalizeFingerprint(bad), null, bad);
  });

  it("never colours a classical or rejected outcome as success", () => {
    assert.strictEqual(decisionTone("allowed-hybrid"), "success");
    assert.strictEqual(decisionTone("allowed-fallback"), "warning");
    assert.strictEqual(decisionTone("rejected-violation"), "danger");
    assert.strictEqual(decisionTone("rejected-unknown-peer"), "danger");
    assert.strictEqual(keyExchangeTone("classical"), "warning");
    assert.strictEqual(keyExchangeTone("hybrid"), "success");
    assert.strictEqual(keyExchangeTone("unknown"), "neutral");
    assert.strictEqual(severityTone("critical"), "danger");
    assert.strictEqual(severityTone("info"), "neutral");
  });

  it("labels every decision", () => {
    assert.strictEqual(Object.keys(DECISION_LABEL).length, 5);
  });

  it("formats measurements and missing values honestly", () => {
    assert.strictEqual(formatMs(null), "-");
    assert.strictEqual(formatMs(undefined), "-");
    assert.strictEqual(formatMs(1.234), "1.23 ms");
    assert.strictEqual(formatMs(42.26), "42.3 ms");
    assert.strictEqual(formatTimeToApply(null), "not yet applied by a sidecar");
    assert.strictEqual(formatTimeToApply(250), "250 ms");
    assert.strictEqual(formatTimeToApply(2500), "2.5 s");
    assert.strictEqual(formatGroupCode(0x11ec), "0x11ec");
    assert.strictEqual(formatGroupCode(0x1d), "0x001d");
    assert.strictEqual(formatGroupCode(null), "-");
    assert.strictEqual(shortFingerprint("ab".repeat(32)), "abababababab...");
    assert.strictEqual(shortFingerprint(null), "-");
  });
});
