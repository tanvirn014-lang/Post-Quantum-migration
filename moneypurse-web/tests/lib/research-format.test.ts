import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BenchLatencySummary, ComparisonMetrics, Discrepancy } from "../../lib/api/security-types.js";
import { GROUND_TRUTH_CAVEATS, formatRatio, groupDiscrepancies, metricRows, parseLookbackHours, sourceHighlights } from "../../lib/cbom-format.js";
import { messageError, parseMosca } from "../../lib/hndl.js";
import { BENCHMARK_SCOPE_NOTE, formatMillis, integrityView, latencyRows, verdictExplanation } from "../../lib/benchmark-format.js";
import { needsPaymentParams, parsePaymentParams, runErrorMessage } from "../../lib/scenario-params.js";

const RESTRICTED = /quantum-(proof|safe|resistant)|fully secure|production-ready|banking compliant|state-of-the-art|emergency swap|real attack simulation/i;

const metrics: ComparisonMetrics = {
  groundTruthItems: 30,
  generatedAssets: 24,
  truePositives: 24,
  falsePositives: 0,
  falseNegatives: 6,
  completeness: 0.8,
  precision: 1,
  denominators: { completeness: "matched ground-truth items / ground-truth items (24 / 30)", precision: "matched generated assets / generated cryptographic assets (24 / 24)" },
  provenanceAgreement: { matched: 24, agreeing: 24, ratio: 1 },
  locationRecall: { groundTruthLocations: 84, found: 33, ratio: 0.3929 },
  byKind: {},
};

describe("CBOM comparison wording", () => {
  it("formats ratios as percentages and a null ratio as n/a, never as 0%", () => {
    assert.strictEqual(formatRatio(0.8), "80.0%");
    assert.strictEqual(formatRatio(0.3929), "39.3%");
    assert.strictEqual(formatRatio(null), "n/a");
    assert.strictEqual(formatRatio(undefined), "n/a");
  });

  it("lists the metrics with their denominators and labels completeness as scoped", () => {
    const rows = metricRows(metrics);
    const completeness = rows.find((r) => r.label.startsWith("Completeness"))!;
    assert.match(completeness.label, /scoped/i);
    assert.strictEqual(completeness.value, "80.0%");
    assert.match(completeness.detail, /24 \/ 30/);
    assert.strictEqual(rows.find((r) => r.label === "False negatives")?.value, "6");
    assert.strictEqual(rows.find((r) => r.label === "Location recall")?.detail, "33 of 84 ground-truth locations appear in the BOM evidence.");
  });

  it("always carries the three caveats: scoped completeness, AI-prepared ground truth, easy precision", () => {
    const text = GROUND_TRUTH_CAVEATS.join(" ");
    assert.match(text, /not coverage of all cryptography/i);
    assert.match(text, /AI assistant/);
    assert.match(text, /needs human review/);
    assert.match(text, /Precision is structurally easy/);
    assert.doesNotMatch(text, RESTRICTED);
  });

  it("groups discrepancies with false negatives first and omits empty groups", () => {
    const list: Discrepancy[] = [
      { type: "location-gap", kind: "algorithm", name: "SHA-256", detail: "d" },
      { type: "missing", kind: "algorithm", name: "HKDF", detail: "d" },
      { type: "missing", kind: "related-crypto-material", name: "token", detail: "d" },
    ];
    const groups = groupDiscrepancies(list);
    assert.deepStrictEqual(groups.map((g) => [g.type, g.items.length]), [["missing", 2], ["location-gap", 1]]);
    assert.deepStrictEqual(groupDiscrepancies([]), []);
  });

  it("reads the free-form source summary defensively", () => {
    const h = sourceHighlights({
      certificates: { refused: [{ path: "k.pem", reason: "path looks like private key material; not opened" }, "junk"] },
      declaredRegister: { unverifiedLocations: [{ entry: "AES", path: "a.ts", check: "token-missing" }] },
      telemetry: { lookbackHours: 24, eventsInWindow: 40, distinctTuples: 3 },
      activeTlsProfile: { name: "hybrid-preferred" },
    });
    assert.deepStrictEqual(h.refusedFiles, [{ path: "k.pem", reason: "path looks like private key material; not opened" }]);
    assert.strictEqual(h.unverifiedLocations.length, 1);
    assert.deepStrictEqual(h.telemetry, { lookbackHours: 24, eventsInWindow: 40, distinctTuples: 3 });
    assert.strictEqual(h.activeProfile, "hybrid-preferred");
    assert.deepStrictEqual(sourceHighlights({}), { refusedFiles: [], unverifiedLocations: [], telemetry: null, activeProfile: null });
    assert.deepStrictEqual(sourceHighlights({ certificates: 5, telemetry: "x" }).refusedFiles, []);
  });

  it("accepts a lookback of 1 to 720 whole hours and nothing else", () => {
    assert.strictEqual(parseLookbackHours("24"), 24);
    assert.strictEqual(parseLookbackHours(" 720 "), 720);
    assert.strictEqual(parseLookbackHours("1"), 1);
    for (const bad of ["", "0", "721", "-5", "1.5", "abc", "1e2"]) assert.strictEqual(parseLookbackHours(bad), null, bad);
  });
});

describe("HNDL form validation", () => {
  it("accepts a toy message of 1 to 256 characters", () => {
    assert.strictEqual(messageError("pay 500"), null);
    assert.strictEqual(messageError("x".repeat(256)), null);
    assert.match(messageError("")!, /Enter/);
    assert.match(messageError("x".repeat(257))!, /At most 256/);
  });

  it("parses the Mosca inputs and reports each bad field separately", () => {
    assert.deepStrictEqual(parseMosca({ shelfLifeYears: "10", migrationYears: "5", yearsToQuantum: "12.5" }), { ok: true, value: { shelfLifeYears: 10, migrationYears: 5, yearsToQuantum: 12.5 } });
    const bad = parseMosca({ shelfLifeYears: "-1", migrationYears: "", yearsToQuantum: "101" });
    assert.strictEqual(bad.ok, false);
    if (!bad.ok) assert.deepStrictEqual(Object.keys(bad.errors).sort(), ["migrationYears", "shelfLifeYears", "yearsToQuantum"]);
    const nan = parseMosca({ shelfLifeYears: "abc", migrationYears: "1", yearsToQuantum: "1" });
    assert.strictEqual(nan.ok, false);
  });
});

describe("benchmark presentation", () => {
  it("never presents an invalid or unverifiable run without a banner, and a valid run needs none", () => {
    assert.strictEqual(integrityView({ status: "valid", problems: [] }).banner, null);
    const invalid = integrityView({ status: "invalid", problems: ["hybrid: 240 of 1000 handshakes failed"] });
    assert.strictEqual(invalid.tone, "danger");
    assert.strictEqual(invalid.label, "INVALID");
    assert.match(invalid.banner!, /not evidence/);
    assert.match(invalid.banner!, /240 of 1000/);
    const unverifiable = integrityView({ status: "unverifiable", problems: ["x"] });
    assert.strictEqual(unverifiable.tone, "warning");
    assert.match(unverifiable.banner!, /unverified/);
  });

  it("formats missing statistics (JSON null for NaN) as a dash", () => {
    assert.strictEqual(formatMillis(1.2345), "1.23 ms");
    assert.strictEqual(formatMillis(null), "-");
    assert.strictEqual(formatMillis(Number.NaN), "-");
  });

  it("explains the verdict from the interval without calling not-distinguishable equal", () => {
    const ci = { estimate: 0.265, lower: 0.153, upper: 0.384, level: 0.95, resamples: 2000, seed: 1 };
    assert.match(verdictExplanation("hybrid-slower", ci), /lies entirely above zero/);
    assert.match(verdictExplanation("hybrid-slower", ci), /0\.153 to 0\.384 ms/);
    assert.match(verdictExplanation("hybrid-faster", ci), /entirely below zero/);
    const straddle = verdictExplanation("not-distinguishable", { ...ci, lower: -0.1, upper: 0.2 });
    assert.match(straddle, /includes zero/);
    assert.match(straddle, /not evidence that they are equal/);
    assert.match(verdictExplanation("not-distinguishable", { ...ci, lower: null, upper: null }), /- to - ms/);
  });

  it("builds the latency table from both conditions", () => {
    const cond = (median: number, failed: number) => ({
      attempted: 9000,
      succeeded: 9000 - failed,
      failed,
      configurationMismatches: 0,
      latencyMs: { n: 9000, mean: median + 0.05, stddev: 0.7, min: 1, median, p95: median + 1, p99: median + 2, max: 9 },
      clientHelloRecordBytes: 235,
      serverHelloRecordBytes: 127,
      bytesSentPerHandshake: 235,
      bytesReceivedPerHandshake: 831,
    });
    const summary = {
      classical: cond(1.84, 0),
      hybrid: cond(2.14, 3),
      hybridMinusClassicalMedianMs: { estimate: 0.3, lower: 0.2, upper: 0.4, level: 0.95, resamples: 2000, seed: 1 },
      h2Verdict: "hybrid-slower",
      h1: { extraClientHelloBytes: 1176, extraServerHelloBytes: 1088, extraBytesSent: 1176, extraBytesReceived: 1078 },
    } satisfies BenchLatencySummary;
    const rows = latencyRows(summary);
    assert.deepStrictEqual(rows[0], { label: "Median", classical: "1.84 ms", hybrid: "2.14 ms" });
    assert.deepStrictEqual(rows.at(-1), { label: "Handshakes ok / failed", classical: "9,000 / 0", hybrid: "8,997 / 3" });
    assert.match(BENCHMARK_SCOPE_NOTE, /no capacity claim/);
    assert.doesNotMatch(BENCHMARK_SCOPE_NOTE, RESTRICTED);
  });
});

describe("payment scenario parameters", () => {
  const ACCOUNT = "11111111-1111-4111-8111-111111111111";

  it("recognises the payment scenarios by their declared requirements or id", () => {
    assert.strictEqual(needsPaymentParams({ id: "partner-payment-hybrid", requires: ["toAccountId"] }), true);
    assert.strictEqual(needsPaymentParams({ id: "partner-payment-x", requires: [] }), true);
    assert.strictEqual(needsPaymentParams({ id: "unregistered-peer", requires: [] }), false);
  });

  it("accepts a UUID, a positive minor-unit amount without a leading zero, and an optional reference", () => {
    assert.deepStrictEqual(parsePaymentParams({ toAccountId: ` ${ACCOUNT} `, amountMinorUnits: "2500", reference: "" }), { ok: true, params: { toAccountId: ACCOUNT, amountMinorUnits: "2500" } });
    assert.deepStrictEqual(parsePaymentParams({ toAccountId: ACCOUNT, amountMinorUnits: "1", reference: " e2e " }), { ok: true, params: { toAccountId: ACCOUNT, amountMinorUnits: "1", reference: "e2e" } });
  });

  it("rejects bad accounts, zero, negative, decimal, leading-zero and oversized amounts, and long references", () => {
    for (const amount of ["0", "-5", "1.5", "007", "", "1234567890123456", "12a"]) {
      const r = parsePaymentParams({ toAccountId: ACCOUNT, amountMinorUnits: amount, reference: "" });
      assert.strictEqual(r.ok, false, amount);
      if (!r.ok) assert.ok(r.errors.amountMinorUnits, amount);
    }
    const account = parsePaymentParams({ toAccountId: "acc_123", amountMinorUnits: "5", reference: "" });
    assert.strictEqual(account.ok === false && Boolean(account.errors.toAccountId), true);
    const long = parsePaymentParams({ toAccountId: ACCOUNT, amountMinorUnits: "5", reference: "x".repeat(101) });
    assert.strictEqual(long.ok === false && Boolean(long.errors.reference), true);
  });

  it("explains an unavailable simulator and passes other errors through", () => {
    assert.match(runErrorMessage({ code: "DEPENDENCY_UNAVAILABLE", status: 503, message: "x" }), /peer simulator is not configured or not reachable/);
    assert.match(runErrorMessage({ status: 503 }), /peer simulator/);
    assert.strictEqual(runErrorMessage({ code: "VALIDATION_ERROR", status: 400, message: "Bad input" }), "Bad input");
    assert.strictEqual(runErrorMessage(null), "The scenario could not be run.");
  });
});
